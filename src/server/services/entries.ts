import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { calculateBreakup, calculateCostBreakup } from "@/lib/calc";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { syncExpense, unsyncExpense } from "@/lib/sheet";
import type { Prisma } from "@/generated/prisma/client";
import { accessibleBusinessIds, accessWhere, assertBusinessAccess, requireEntryAccess } from "../access";
import { audit, diff } from "../audit";
import { badRequest } from "../errors";
import type { SessionUser } from "../session";
import { id, isoDate, optionalText, percent, positiveMoney } from "../validation";
import { guardWrite, rupees } from "./common";

/**
 * Money in (a receipt through a gateway: gross -> gateway charge -> GST -> net)
 * and money out (a GST-inclusive cost), outside invoices. Stored in the
 * Expense table; "entry" is the word the app uses for both.
 */

export const entrySchema = z.object({
  businessId: id,
  direction: z.enum(["IN", "OUT"]).default("IN"),
  categoryId: id,
  gatewayId: id.optional(),
  description: optionalText(500),
  date: isoDate("Date"),
  grossAmount: positiveMoney("Amount"),
  gstPercent: percent("GST %").default(0),
});

export const entryFilterSchema = z.object({
  businessId: id.optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  from: isoDate("From").optional(),
  to: isoDate("To").optional(),
  q: z.string().trim().max(100).optional(),
});

const SCREENSHOT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

async function storeScreenshot(file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.type && !SCREENSHOT_TYPES.includes(file.type)) throw badRequest("Proof must be an image or a PDF");
  if (file.size > 4 * 1024 * 1024) throw badRequest("Proof must be under 4 MB");
  return saveUpload(file);
}

/** Checks the category/gateway belong to the business and works out the breakup. */
async function computeEntry(input: z.infer<typeof entrySchema>) {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { businessId: true, name: true } });
  if (!category || category.businessId !== input.businessId) {
    throw badRequest("Pick a category from this business", { categoryId: "Not a category of this business" });
  }

  // Money out is a cost: no gateway takes a cut of it.
  const gatewayId = input.direction === "IN" ? (input.gatewayId ?? null) : null;
  let gatewayChargePercent = 0;
  if (gatewayId) {
    const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId }, select: { businessId: true, chargePercent: true } });
    if (!gateway || gateway.businessId !== input.businessId) {
      throw badRequest("Pick a gateway from this business", { gatewayId: "Not a gateway of this business" });
    }
    gatewayChargePercent = gateway.chargePercent;
  }

  const breakup =
    input.direction === "OUT"
      ? { gatewayChargeAmount: 0, ...calculateCostBreakup({ grossAmount: input.grossAmount, gstPercent: input.gstPercent }) }
      : calculateBreakup({ grossAmount: input.grossAmount, gatewayChargePercent, gstPercent: input.gstPercent });

  return {
    businessId: input.businessId,
    direction: input.direction,
    categoryId: input.categoryId,
    gatewayId,
    description: input.description,
    date: input.date,
    grossAmount: input.grossAmount,
    gatewayChargePercent,
    gatewayChargeAmount: breakup.gatewayChargeAmount,
    gstPercent: input.gstPercent,
    gstAmount: breakup.gstAmount,
    netAmount: breakup.netAmount,
    categoryName: category.name,
  };
}

export async function listEntries(user: SessionUser, filters: z.infer<typeof entryFilterSchema>) {
  if (filters.businessId) await assertBusinessAccess(user, filters.businessId);
  const access = await accessibleBusinessIds(user);
  const where: Prisma.ExpenseWhereInput = {
    ...(filters.businessId ? { businessId: filters.businessId } : accessWhere(access)),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: filters.from } : {}),
            // `to` is a whole day.
            ...(filters.to ? { lt: new Date(filters.to.getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { description: { contains: filters.q, mode: "insensitive" } },
            { category: { name: { contains: filters.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  return prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
    take: 500,
    include: {
      business: { select: { name: true, slug: true, color: true } },
      category: { select: { name: true } },
      gateway: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

export async function getEntry(user: SessionUser, entryId: string) {
  return requireEntryAccess(user, entryId);
}

export async function createEntry(user: SessionUser, input: z.infer<typeof entrySchema>, form: FormData, req: Request) {
  await guardWrite(user);
  await assertBusinessAccess(user, input.businessId);
  const { categoryName, ...data } = await computeEntry(input);
  const screenshotPath = await storeScreenshot(form.get("screenshot"));

  const entry = await prisma.expense.create({ data: { ...data, screenshotPath, createdById: user.id } });

  await audit({
    user,
    businessId: entry.businessId,
    action: "entry.create",
    entityType: "entry",
    entityId: entry.id,
    summary: `${entry.direction === "OUT" ? "Money out" : "Money in"} ${rupees(entry.grossAmount)} · ${entry.description || categoryName}`,
    req,
  });

  // Keeps the business's sheet (and so its P&L) current without re-keying.
  after(() => syncExpense(entry.id));
  return entry;
}

const LABELS = {
  businessId: "business",
  direction: "direction",
  categoryId: "category",
  gatewayId: "gateway",
  description: "description",
  date: "date",
  grossAmount: "amount",
  gstPercent: "GST %",
} as const;

export async function updateEntry(user: SessionUser, entryId: string, input: z.infer<typeof entrySchema>, form: FormData, req: Request) {
  await guardWrite(user);
  const existing = await requireEntryAccess(user, entryId);
  // Moving an entry to another business needs access to that one too.
  if (input.businessId !== existing.businessId) await assertBusinessAccess(user, input.businessId);

  const { categoryName, ...data } = await computeEntry(input);
  const newScreenshot = await storeScreenshot(form.get("screenshot"));

  const entry = await prisma.expense.update({
    where: { id: entryId },
    data: { ...data, ...(newScreenshot ? { screenshotPath: newScreenshot } : {}) },
  });
  if (newScreenshot && existing.screenshotPath) await deleteUpload(existing.screenshotPath).catch(() => {});

  const changed = diff(existing, data, LABELS);
  await audit({
    user,
    businessId: entry.businessId,
    action: "entry.update",
    entityType: "entry",
    entityId: entryId,
    summary: `Edited ${entry.description || categoryName}: ${changed.summary || (newScreenshot ? "new proof" : "no changes")}`,
    changes: changed.changes,
    req,
  });

  // Upserted in place; a changed business or direction clears the old row first.
  after(() => syncExpense(entryId, { businessId: existing.businessId, direction: existing.direction }));
  return entry;
}

export async function deleteEntry(user: SessionUser, entryId: string, req: Request) {
  await guardWrite(user);
  const entry = await requireEntryAccess(user, entryId);

  await prisma.expense.delete({ where: { id: entryId } });
  if (entry.screenshotPath) await deleteUpload(entry.screenshotPath).catch(() => {});

  await audit({
    user,
    businessId: entry.businessId,
    action: "entry.delete",
    entityType: "entry",
    entityId: entryId,
    summary: `Deleted ${entry.direction === "OUT" ? "money out" : "money in"} ${rupees(entry.grossAmount)}${entry.description ? ` · ${entry.description}` : ""}`,
    req,
  });
  after(() => unsyncExpense(entry.businessId, entry.direction, entryId));
}
