import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sealSecret } from "@/lib/secretBox";
import { accessibleBusinessIds, assertBusinessAccess } from "../access";
import { audit, diff } from "../audit";
import { businessSummarySelect, seqInSeries, sheetSource, sheetTarget, slugify } from "../businesses";
import { badRequest, conflict, notFound } from "../errors";
import type { SessionUser } from "../session";
import { id, percent, requiredText } from "../validation";
import { guardWrite } from "./common";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Use lowercase letters, numbers and dashes (e.g. ipc)");
const color = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour like #6a6cf0");
const prefix = z.string().trim().min(1, "A prefix is required").max(16).regex(/^[A-Za-z0-9/_-]+$/, "Letters, numbers, - / _ only");
const nextNumber = z.coerce.number().int("A whole number").min(1, "At least 1").max(99_999_999);

export const createBusinessSchema = z.object({
  name: requiredText("Name", 120),
  slug: slug.optional(),
  entity: z.enum(["GRATEFUL", "MULBERRY"]),
  color: color.optional(),
  invoicePrefix: prefix,
  invoiceNextNumber: nextNumber,
  defaultGstPercent: percent("Default GST %").optional(),
});

export const updateBusinessSchema = z.object({
  name: requiredText("Name", 120).optional(),
  slug: slug.optional(),
  entity: z.enum(["GRATEFUL", "MULBERRY"]).optional(),
  color: color.optional(),
  invoicePrefix: prefix.optional(),
  invoiceNextNumber: nextNumber.optional(),
  defaultGstPercent: percent("Default GST %").optional(),
  sheetUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v), "Paste the web app's /exec URL from Apps Script")
    .optional(),
  /** Write-only. "" clears the connection (URL and secret). */
  sheetSecret: z.string().max(200).optional(),
  archived: z.boolean().optional(),
  /** Confirms an automatically set-up business. */
  reviewed: z.literal(true).optional(),
});

export const categorySchema = z.object({ name: requiredText("Category name", 60) });
export const gatewaySchema = z.object({ name: requiredText("Gateway name", 60), chargePercent: percent("Charge %") });
export const gatewayUpdateSchema = gatewaySchema.partial();
export const membersSchema = z.object({ userIds: z.array(id) });

/** Everything Settings shows for a business, minus the sheet secret. */
export async function getBusinessDetail(user: SessionUser, businessId: string) {
  await assertBusinessAccess(user, businessId);
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      categories: { orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { expenses: true } } } },
      gateways: { orderBy: { name: "asc" }, select: { id: true, name: true, chargePercent: true, _count: { select: { expenses: true } } } },
      members: { select: { userId: true } },
      _count: { select: { invoices: true, expenses: true } },
    },
  });
  if (!b) throw notFound("That business");
  const { sheetSecretEnc, ...rest } = b;
  return { ...rest, sheetConnected: sheetSource(b), hasSheetSecret: Boolean(sheetSecretEnc) };
}

export async function listBusinesses(user: SessionUser) {
  const access = await accessibleBusinessIds(user);
  return prisma.business.findMany({
    where: access === "ALL" ? {} : { id: { in: access }, archivedAt: null },
    select: businessSummarySelect,
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 100; i++) {
    const clash = await prisma.business.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash || clash.id === exceptId) return candidate;
    candidate = `${base}-${i}`;
  }
  throw conflict("Couldn't find a free short name — choose one");
}

export async function createBusiness(admin: SessionUser, input: z.infer<typeof createBusinessSchema>, req: Request) {
  await guardWrite(admin);
  if (input.slug && (await prisma.business.findUnique({ where: { slug: input.slug }, select: { id: true } }))) {
    throw conflict(`The short name "${input.slug}" is taken`);
  }
  const businessSlug = input.slug ?? (await uniqueSlug(slugify(input.name)));

  const business = await prisma.business.create({
    data: {
      name: input.name,
      slug: businessSlug,
      entity: input.entity,
      color: input.color ?? "#6a6cf0",
      invoicePrefix: input.invoicePrefix,
      invoiceNextNumber: input.invoiceNextNumber,
      defaultGstPercent: input.defaultGstPercent ?? (input.entity === "MULBERRY" ? 0 : 18),
    },
    select: businessSummarySelect,
  });
  await audit({
    user: admin,
    businessId: business.id,
    action: "business.create",
    entityType: "business",
    entityId: business.id,
    summary: `Created ${business.name} (${business.entity === "MULBERRY" ? "Mulberry" : "Grateful"}, ${business.invoicePrefix}…)`,
    req,
  });
  return business;
}

const LABELS = {
  name: "name",
  slug: "short name",
  entity: "legal entity",
  color: "colour",
  invoicePrefix: "prefix",
  invoiceNextNumber: "next number",
  defaultGstPercent: "default GST %",
  sheetUrl: "sheet URL",
} as const;

export async function updateBusiness(admin: SessionUser, businessId: string, input: z.infer<typeof updateBusinessSchema>, req: Request) {
  await guardWrite(admin);
  const existing = await prisma.business.findUnique({ where: { id: businessId } });
  if (!existing) throw notFound("That business");

  if (input.slug && input.slug !== existing.slug) {
    const clash = await prisma.business.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (clash) throw conflict(`The short name "${input.slug}" is taken`);
  }

  // The counter can't go back below a number already issued in the series, or
  // the next invoice would collide with an existing one.
  const prefixAfter = input.invoicePrefix ?? existing.invoicePrefix;
  if (input.invoiceNextNumber !== undefined || input.invoicePrefix !== undefined) {
    const next = input.invoiceNextNumber ?? existing.invoiceNextNumber;
    const issued = await prisma.invoice.findMany({
      where: { businessId, invoiceNumber: { startsWith: prefixAfter } },
      select: { invoiceNumber: true },
    });
    const highest = issued.reduce((max, i) => Math.max(max, seqInSeries(i.invoiceNumber, prefixAfter) ?? 0), 0);
    if (next <= highest) {
      throw badRequest(`${prefixAfter}${String(highest).padStart(6, "0")} has already been issued — the next number must be above ${highest}`, {
        invoiceNextNumber: `Above ${highest}`,
      });
    }
  }

  // Issued invoices keep their seller; changing the entity only affects new ones.
  const clearSheet = input.sheetSecret === "" || input.sheetUrl === "";
  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.entity !== undefined ? { entity: input.entity } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.invoicePrefix !== undefined ? { invoicePrefix: input.invoicePrefix } : {}),
    ...(input.invoiceNextNumber !== undefined ? { invoiceNextNumber: input.invoiceNextNumber } : {}),
    ...(input.defaultGstPercent !== undefined ? { defaultGstPercent: input.defaultGstPercent } : {}),
    ...(clearSheet
      ? { sheetUrl: null, sheetSecretEnc: null }
      : {
          ...(input.sheetUrl !== undefined ? { sheetUrl: input.sheetUrl } : {}),
          ...(input.sheetSecret ? { sheetSecretEnc: sealSecret(input.sheetSecret) } : {}),
        }),
    ...(input.archived !== undefined ? { archivedAt: input.archived ? (existing.archivedAt ?? new Date()) : null } : {}),
    ...(input.reviewed ? { needsReview: false } : {}),
  };
  if (!clearSheet && (data.sheetUrl ?? existing.sheetUrl) && !(input.sheetSecret || existing.sheetSecretEnc)) {
    throw badRequest("Add the sheet's secret too (the SECRET at the top of its script)", { sheetSecret: "Required with a URL" });
  }

  const business = await prisma.business.update({ where: { id: businessId }, data, select: businessSummarySelect });

  const changed = diff(existing, data as Partial<typeof existing>, LABELS);
  const extras = [
    input.sheetSecret ? "sheet secret updated" : null,
    clearSheet ? "sheet disconnected" : null,
    input.archived !== undefined && Boolean(existing.archivedAt) !== input.archived ? (input.archived ? "archived" : "restored") : null,
    input.reviewed && existing.needsReview ? "settings confirmed" : null,
  ].filter(Boolean);
  await audit({
    user: admin,
    businessId,
    action: "business.update",
    entityType: "business",
    entityId: businessId,
    summary: `${business.name}: ${[changed.summary, ...extras].filter(Boolean).join(", ") || "no changes"}`,
    changes: changed.changes,
    req,
  });
  return business;
}

/** Calls the sheet's doGet to prove the URL works (the secret is only checked on writes). */
export async function testBusinessSheet(businessId: string): Promise<{ ok: boolean; workbook?: string; error?: string }> {
  const target = await sheetTarget(businessId);
  if (!target) return { ok: false, error: "No sheet is connected to this business yet" };
  try {
    const res = await fetch(target.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `The sheet answered ${res.status}` };
    try {
      const body = JSON.parse(text) as { ok?: boolean; workbook?: string };
      return body.ok ? { ok: true, workbook: body.workbook } : { ok: false, error: "The script answered, but not with ok" };
    } catch {
      return { ok: false, error: "That URL didn't answer like the Payment Sync script — is it the /exec URL, deployed with access for Anyone?" };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "The sheet took over 10 seconds to answer" : "Couldn't reach the sheet" };
  }
}

// --- Categories, gateways and members -------------------------------------------

async function requireBusiness(businessId: string) {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
  if (!b) throw notFound("That business");
  return b;
}

export async function addCategory(admin: SessionUser, businessId: string, name: string, req: Request) {
  await guardWrite(admin);
  const b = await requireBusiness(businessId);
  if (await prisma.category.findUnique({ where: { businessId_name: { businessId, name } }, select: { id: true } })) {
    throw conflict(`${b.name} already has a "${name}" category`);
  }
  const category = await prisma.category.create({ data: { businessId, name } });
  await audit({ user: admin, businessId, action: "category.create", entityType: "category", entityId: category.id, summary: `${b.name}: added category ${name}`, req });
  return category;
}

export async function removeCategory(admin: SessionUser, businessId: string, categoryId: string, req: Request) {
  await guardWrite(admin);
  const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { _count: { select: { expenses: true } } } });
  if (!category || category.businessId !== businessId) throw notFound("That category");
  if (category._count.expenses > 0) {
    throw conflict(`${category._count.expenses} entr${category._count.expenses === 1 ? "y uses" : "ies use"} "${category.name}" — move them to another category first`);
  }
  await prisma.category.delete({ where: { id: categoryId } });
  await audit({ user: admin, businessId, action: "category.delete", entityType: "category", entityId: categoryId, summary: `Removed category ${category.name}`, req });
}

export async function addGateway(admin: SessionUser, businessId: string, input: z.infer<typeof gatewaySchema>, req: Request) {
  await guardWrite(admin);
  const b = await requireBusiness(businessId);
  const gateway = await prisma.gateway.create({ data: { businessId, name: input.name, chargePercent: input.chargePercent } });
  await audit({
    user: admin,
    businessId,
    action: "gateway.create",
    entityType: "gateway",
    entityId: gateway.id,
    summary: `${b.name}: added gateway ${input.name} (${input.chargePercent}%)`,
    req,
  });
  return gateway;
}

export async function updateGateway(admin: SessionUser, businessId: string, gatewayId: string, input: z.infer<typeof gatewayUpdateSchema>, req: Request) {
  await guardWrite(admin);
  const existing = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!existing || existing.businessId !== businessId) throw notFound("That gateway");
  // Entries already recorded keep the charge they were saved with.
  const gateway = await prisma.gateway.update({ where: { id: gatewayId }, data: input });
  const changed = diff(existing, input, { name: "name", chargePercent: "charge %" });
  await audit({
    user: admin,
    businessId,
    action: "gateway.update",
    entityType: "gateway",
    entityId: gatewayId,
    summary: `Gateway ${existing.name}: ${changed.summary || "no changes"}`,
    changes: changed.changes,
    req,
  });
  return gateway;
}

export async function removeGateway(admin: SessionUser, businessId: string, gatewayId: string, req: Request) {
  await guardWrite(admin);
  const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId }, include: { _count: { select: { expenses: true } } } });
  if (!gateway || gateway.businessId !== businessId) throw notFound("That gateway");
  if (gateway._count.expenses > 0) {
    throw conflict(`${gateway._count.expenses} entr${gateway._count.expenses === 1 ? "y was" : "ies were"} received through ${gateway.name}, so it can't be removed`);
  }
  await prisma.gateway.delete({ where: { id: gatewayId } });
  await audit({ user: admin, businessId, action: "gateway.delete", entityType: "gateway", entityId: gatewayId, summary: `Removed gateway ${gateway.name}`, req });
}

export async function setMembers(admin: SessionUser, businessId: string, userIds: string[], req: Request) {
  await guardWrite(admin);
  const b = await requireBusiness(businessId);
  const unique = [...new Set(userIds)];
  if ((await prisma.user.count({ where: { id: { in: unique } } })) !== unique.length) throw badRequest("One of those people doesn't exist");

  await prisma.$transaction([
    prisma.businessMember.deleteMany({ where: { businessId, userId: { notIn: unique } } }),
    ...unique.map((userId) =>
      prisma.businessMember.upsert({
        where: { userId_businessId: { userId, businessId } },
        create: { userId, businessId },
        update: {},
      })
    ),
  ]);
  const names = await prisma.user.findMany({ where: { id: { in: unique } }, select: { name: true } });
  await audit({
    user: admin,
    businessId,
    action: "business.members",
    entityType: "business",
    entityId: businessId,
    summary: `${b.name} team: ${names.map((n) => n.name).join(", ") || "admins only"}`,
    req,
  });
}
