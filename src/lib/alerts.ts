import { startOfTodayIST } from "@/lib/dates";
import { prisma } from "./prisma";
import { invoiceBalance } from "./invoiceLines";

/**
 * Which businesses an alert query covers: "ALL" (an admin on "All businesses")
 * or an explicit list — the current business, or a member's own businesses.
 * Members must never be told about businesses they can't open.
 */
export type AlertScope = "ALL" | string[];

function businessFilter(scope: AlertScope) {
  return scope === "ALL" ? {} : { businessId: { in: scope } };
}

/** Must match BAJAJ_DISBURSEMENT in src/server/services/invoices.ts. */
const BAJAJ_DISBURSEMENT = "Bajaj Finance disbursement";

/** What the balance rule and the overdue checks need about each open invoice. */
const openInvoiceSelect = {
  grossAmount: true,
  status: true,
  saleType: true,
  financedAmount: true,
  dueDate: true,
  creditNotes: { select: { grossAmount: true } },
  payments: { select: { amount: true, kind: true, tdsAmount: true, method: true } },
} as const;

type OpenInvoice = {
  grossAmount: number;
  status: string;
  saleType: string;
  financedAmount: number | null;
  dueDate: Date;
  creditNotes: { grossAmount: number }[];
  payments: { amount: number; kind: string; tdsAmount: number; method: string | null }[];
};

/** A Bajaj sale Bajaj hasn't paid out yet: waiting on Bajaj, not on the customer. */
function isAwaitingBajaj(inv: OpenInvoice): boolean {
  return inv.saleType === "BAJAJ" && !inv.payments.some((p) => p.method === BAJAJ_DISBURSEMENT);
}

/**
 * Overdue = past its due date with something still to collect (after credit
 * notes and refunds), not cancelled, and not merely waiting on Bajaj.
 */
function overdueBalances(invoices: OpenInvoice[]): number[] {
  return invoices
    .filter((inv) => !isAwaitingBajaj(inv))
    .map((inv) => invoiceBalance(inv))
    .filter((b) => !b.cancelled && !b.settled)
    .map((b) => b.balance);
}

async function pastDueInvoices(scope: AlertScope): Promise<OpenInvoice[]> {
  return prisma.invoice.findMany({
    where: { dueDate: { lt: startOfToday() }, status: { not: "CANCELLED" }, ...businessFilter(scope) },
    select: openInvoiceSelect,
  });
}

/**
 * How many things need attention, for the badge on every page. A failure here
 * must never take the whole app down, so it degrades to zero. Pass the user's
 * accessible business ids (or "ALL" for an admin).
 */
export async function alertCount(scope: AlertScope = "ALL"): Promise<number> {
  try {
    const [failures, pastDue] = await Promise.all([
      prisma.sheetSyncFailure.count({ where: { resolvedAt: null, ...businessFilter(scope) } }),
      pastDueInvoices(scope),
    ]);
    return failures + overdueBalances(pastDue).length;
  } catch (error) {
    console.error("Couldn't count alerts:", error);
    return 0;
  }
}

/**
 * Bajaj Finance sales raised but not yet paid out by Bajaj: how many, and how
 * much Bajaj still owes (the financed part of each invoice's balance).
 */
export async function awaitingBajaj(scope: AlertScope): Promise<{ count: number; amount: number }> {
  const invoices = await prisma.invoice.findMany({
    where: {
      saleType: "BAJAJ",
      status: { not: "CANCELLED" },
      payments: { none: { method: BAJAJ_DISBURSEMENT } },
      ...businessFilter(scope),
    },
    select: openInvoiceSelect,
  });
  let count = 0;
  let amount = 0;
  for (const inv of invoices) {
    const { balance, settled } = invoiceBalance(inv);
    if (settled) continue;
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
  const open = overdueBalances(await pastDueInvoices(scope));
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
