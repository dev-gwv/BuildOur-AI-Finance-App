import { prisma } from "./prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Which businesses an alert query covers: "ALL" (an admin on "All businesses")
 * or an explicit list — the current business, or a member's own businesses.
 * Members must never be told about businesses they can't open.
 */
export type AlertScope = "ALL" | string[];

function businessFilter(scope: AlertScope) {
  return scope === "ALL" ? {} : { businessId: { in: scope } };
}

function sqlBusinessFilter(scope: AlertScope) {
  if (scope === "ALL") return Prisma.empty;
  if (scope.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND i."businessId" IN (${Prisma.join(scope)})`;
}

/**
 * How many things need attention, for the badge on every page. Two cheap
 * queries; a failure here must never take the whole app down, so it degrades
 * to zero. Pass the user's accessible business ids (or "ALL" for an admin).
 */
export async function alertCount(scope: AlertScope = "ALL"): Promise<number> {
  try {
    const [failures, overdue] = await Promise.all([
      prisma.sheetSyncFailure.count({ where: { resolvedAt: null, ...businessFilter(scope) } }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "Invoice" i
        WHERE i."dueDate" < NOW()
          AND i."grossAmount" - COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."invoiceId" = i."id"), 0) > 0.5
          ${sqlBusinessFilter(scope)}`,
    ]);
    return failures + Number(overdue[0]?.count ?? 0);
  } catch (error) {
    console.error("Couldn't count alerts:", error);
    return 0;
  }
}

export interface OverdueSummary {
  count: number;
  amount: number;
}

export async function overdueInvoices(scope: AlertScope): Promise<OverdueSummary> {
  const invoices = await prisma.invoice.findMany({
    where: { dueDate: { lt: new Date() }, ...businessFilter(scope) },
    select: { grossAmount: true, payments: { select: { amount: true } } },
  });
  const open = invoices
    .map((inv) => inv.grossAmount - inv.payments.reduce((s, p) => s + p.amount, 0))
    .filter((balance) => balance > 0.5);
  return {
    count: open.length,
    amount: Math.round(open.reduce((s, b) => s + b, 0) * 100) / 100,
  };
}

/** Unresolved sheet-write failures in scope, grouped by business name. */
export async function syncFailures(scope: AlertScope): Promise<{ count: number; businesses: string[] }> {
  const rows = await prisma.sheetSyncFailure.findMany({
    where: { resolvedAt: null, ...businessFilter(scope) },
    select: { businessId: true },
  });
  if (rows.length === 0) return { count: 0, businesses: [] };
  const names = await prisma.business.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.businessId))] } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return { count: rows.length, businesses: names.map((n) => n.name) };
}
