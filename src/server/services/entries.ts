import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { calculateBreakup, calculateCostBreakup } from "@/lib/calc";
import { UnsupportedUpload, deleteUpload, saveUpload } from "@/lib/storage";
import { syncExpense, unsyncExpense } from "@/lib/sheet";
import type { Prisma } from "@/generated/prisma/client";
import { accessibleBusinessIds, accessWhere, assertBusinessAccess, requireEntryAccess } from "../access";
import { assertPeriodOpen } from "../gstLock";
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

export const entrySchema = z
  .object({
    businessId: id,
    direction: z.enum(["IN", "OUT"]).default("IN"),
    /** A category typed by name: reused if the business has it, created if not. */
    categoryName: z.string().trim().max(60, "Keep the category under 60 characters").optional(),
    /** Still accepted from older clients; categoryName wins when both are sent. */
    categoryId: id.optional(),
    gatewayId: id.optional(),
    /** For money out this is the expense itself ("Office rent — September"). */
    description: optionalText(500),
    date: isoDate("Date"),
    grossAmount: positiveMoney("Amount"),
    gstPercent: percent("GST %").default(0),
  })
  .superRefine((v, ctx) => {
    if (v.direction === "OUT" && !v.description) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "Say what the expense was for" });
    }
  });

/** The category every entry falls back to when none is given. */
const DEFAULT_CATEGORY = "General";

export const entryFilterSchema = z.object({
  businessId: id.optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  from: isoDate("From").optional(),
  to: isoDate("To").optional(),
  q: z.string().trim().max(100).optional(),
});

const SCREENSHOT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

const PROOF_NOT_SAVED = "Saved — but the proof file couldn't be stored right now. Edit the entry to attach it again.";

/**
 * Stores an entry's proof. A wrong file is the user's to fix (400); storage
 * being unavailable isn't, so the entry is still saved, with a warning,
 * rather than lost — the same rule as invoices and payments.
 */
async function storeScreenshot(file: FormDataEntryValue | null): Promise<{ path: string | null; warning: string | null }> {
  if (!(file instanceof File) || file.size === 0) return { path: null, warning: null };
  // No declared type is no excuse: the file is checked either way (and storage
  // checks its actual contents too).
  if (!SCREENSHOT_TYPES.includes(file.type)) throw badRequest("Proof must be an image or a PDF");
  if (file.size > 4 * 1024 * 1024) throw badRequest("Proof must be under 4 MB");
  try {
    return { path: await saveUpload(file), warning: null };
  } catch (e) {
    if (e instanceof UnsupportedUpload) throw badRequest(e.message);
    console.error("Couldn't store an entry's proof:", e);
    return { path: null, warning: PROOF_NOT_SAVED };
  }
}

/**
 * The category an entry goes under: a typed name (matched case-insensitively,
 * created for the business if it's new), else a given id, else the entry's
 * current one when editing, else "General". So a business with no categories
 * set up can still record money.
 */
async function resolveCategory(
  input: z.infer<typeof entrySchema>,
  fallbackCategoryId?: string | null
): Promise<{ id: string; name: string }> {
  const findOrCreate = async (rawName: string) => {
    const name = rawName.replace(/\s+/g, " ").trim().slice(0, 60);
    const existing = await prisma.category.findFirst({
      where: { businessId: input.businessId, name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    try {
      return await prisma.category.create({ data: { businessId: input.businessId, name }, select: { id: true, name: true } });
    } catch {
      // Someone created it at the same moment: use theirs.
      return prisma.category.findFirstOrThrow({
        where: { businessId: input.businessId, name: { equals: name, mode: "insensitive" } },
        select: { id: true, name: true },
      });
    }
  };

  if (input.categoryName) return findOrCreate(input.categoryName);

  for (const candidate of [input.categoryId, fallbackCategoryId]) {
    if (!candidate) continue;
    const category = await prisma.category.findUnique({ where: { id: candidate }, select: { id: true, name: true, businessId: true } });
    if (category && category.businessId === input.businessId) return { id: category.id, name: category.name };
    if (candidate === input.categoryId) {
      throw badRequest("Pick a category from this business", { categoryName: "Not a category of this business" });
    }
  }
  return findOrCreate(DEFAULT_CATEGORY);
}

/** Checks the gateway belongs to the business, resolves the category, and works out the breakup. */
async function computeEntry(input: z.infer<typeof entrySchema>, fallbackCategoryId?: string | null) {
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
  // After the gateway check, so a rejected entry doesn't leave a new category behind.
  const category = await resolveCategory(input, fallbackCategoryId);

  const breakup =
    input.direction === "OUT"
      ? { gatewayChargeAmount: 0, ...calculateCostBreakup({ grossAmount: input.grossAmount, gstPercent: input.gstPercent }) }
      : calculateBreakup({ grossAmount: input.grossAmount, gatewayChargePercent, gstPercent: input.gstPercent });

  return {
    businessId: input.businessId,
    direction: input.direction,
    categoryId: category.id,
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
  // Money out carries input GST claimed in a return: a filed period is closed.
  if (input.direction === "OUT") await assertPeriodOpen(input.businessId, [input.date], "That date");
  const { categoryName, ...data } = await computeEntry(input);
  const { path: screenshotPath, warning } = await storeScreenshot(form.get("screenshot"));

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
  return { entry, warning };
}

const LABELS = {
  businessId: "business",
  direction: "direction",
  categoryId: "category",
  gatewayId: "gateway",
  description: "expense",
  date: "date",
  grossAmount: "amount",
  gstPercent: "GST %",
} as const;

export async function updateEntry(user: SessionUser, entryId: string, input: z.infer<typeof entrySchema>, form: FormData, req: Request) {
  await guardWrite(user);
  const existing = await requireEntryAccess(user, entryId);
  // Moving an entry to another business needs access to that one too.
  if (input.businessId !== existing.businessId) await assertBusinessAccess(user, input.businessId);
  // A money-out entry can't be changed in, moved into, or moved out of a filed GST period.
  if (existing.direction === "OUT") await assertPeriodOpen(existing.businessId, [existing.date], "This cost");
  if (input.direction === "OUT") await assertPeriodOpen(input.businessId, [input.date], "That date");

  // With no category sent and the business unchanged, the entry keeps its own.
  const { categoryName, ...data } = await computeEntry(
    input,
    input.businessId === existing.businessId ? existing.categoryId : null
  );
  const { path: newScreenshot, warning } = await storeScreenshot(form.get("screenshot"));

  const entry = await prisma.expense.update({
    where: { id: entryId },
    data: { ...data, ...(newScreenshot ? { screenshotPath: newScreenshot } : {}) },
  });
  if (newScreenshot && existing.screenshotPath) await deleteUpload(existing.screenshotPath).catch(() => {});

  // Compare by name, not id, so the stored summary reads "category Ads → Rent".
  const ids = [existing.businessId, data.businessId, existing.categoryId, data.categoryId, existing.gatewayId, data.gatewayId]
    .filter((v): v is string => Boolean(v));
  const [businesses, categories, gateways] = await Promise.all([
    prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.gateway.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...businesses, ...categories, ...gateways].map((r) => [r.id, r.name]));
  const named = <T extends { businessId: string; categoryId: string; gatewayId: string | null }>(r: T) => ({
    ...r,
    businessId: names.get(r.businessId) ?? r.businessId,
    categoryId: names.get(r.categoryId) ?? r.categoryId,
    gatewayId: r.gatewayId ? (names.get(r.gatewayId) ?? r.gatewayId) : null,
  });
  const changed = diff(named(existing), named(data), LABELS);
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
  return { entry, warning };
}

export async function deleteEntry(user: SessionUser, entryId: string, req: Request) {
  await guardWrite(user);
  const entry = await requireEntryAccess(user, entryId);
  if (entry.direction === "OUT") await assertPeriodOpen(entry.businessId, [entry.date], "This cost");

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
