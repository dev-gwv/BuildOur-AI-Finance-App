import { startOfTodayIST } from "@/lib/dates";
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
        WHERE i."dueDate" < date_trunc('day', NOW())
          AND i."grossAmount" - COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."invoiceId" = i."id"), 0) > 0.5
          -- A Bajaj sale still waiting on Bajaj's payout isn't overdue from the customer.
          AND NOT (i."saleType" = 'BAJAJ' AND NOT EXISTS (
            SELECT 1 FROM "Payment" p WHERE p."invoiceId" = i."id" AND p."method" = ${BAJAJ_DISBURSEMENT}))
          ${sqlBusinessFilter(scope)}`,
    ]);
    return failures + Number(overdue[0]?.count ?? 0);
  } catch (error) {
    console.error("Couldn't count alerts:", error);
    return 0;
  }
}

/** Must match BAJAJ_DISBURSEMENT in src/server/services/invoices.ts. */
const BAJAJ_DISBURSEMENT = "Bajaj Finance disbursement";

/**
 * Bajaj Finance sales raised but not yet paid out by Bajaj: how many, and how
 * much Bajaj still owes (the financed part of each invoice's balance).
 */
export async function awaitingBajaj(scope: AlertScope): Promise<{ count: number; amount: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { saleType: "BAJAJ", payments: { none: { method: BAJAJ_DISBURSEMENT } }, ...businessFilter(scope) },
    select: { grossAmount: true, financedAmount: true, payments: { select: { amount: true } } },
  });
  let count = 0;
  let amount = 0;
  for (const inv of invoices) {
    const balance = inv.grossAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
    if (balance <= 0.5) continue;
    count += 1;
    amount += Math.min(inv.financedAmount ?? balance, balance);
  }
  return { count, amount: Math.round(amount * 100) / 100 };
}

export interface OverdueSummary {
  count: number;
  amount: number;
}

export async function overdueInvoices(scope: AlertScope): Promise<OverdueSummary> {
  const invoices = await prisma.invoice.findMany({
    where: { dueDate: { lt: startOfToday() }, ...businessFilter(scope) },
    select: { grossAmount: true, saleType: true, payments: { select: { amount: true, method: true } } },
  });
  const open = invoices
    // Waiting on Bajaj's payout is tracked separately (awaitingBajaj), not as overdue.
    .filter((inv) => !(inv.saleType === "BAJAJ" && !inv.payments.some((p) => p.method === BAJAJ_DISBURSEMENT)))
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

/**
 * Due dates are calendar days (stored at midnight UTC), so an invoice due today
 * isn't overdue until tomorrow — compare against the start of today, not now.
 */
export function startOfToday(now = new Date()): Date {
  // Today on the Indian calendar, as the midnight-UTC instant dates are stored at.
  return startOfTodayIST(now);
}
