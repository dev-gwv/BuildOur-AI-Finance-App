import { prisma } from "./prisma";
import { ledgerForInvoice, type LedgerKey } from "./ventures";

/**
 * How many things need attention, for the badge on every page. Two cheap
 * queries; a failure here must never take the whole app down, so it degrades
 * to zero.
 */
export async function alertCount(): Promise<number> {
  try {
    const [failures, overdue] = await Promise.all([
      prisma.sheetSyncFailure.count({ where: { resolvedAt: null } }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "Invoice" i
        WHERE i."dueDate" < NOW()
          AND i."grossAmount" - COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."invoiceId" = i."id"), 0) > 0.5`,
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
  /** Which section the overdue invoices sit in, when they all sit in one. */
  onlyLedger: LedgerKey | "LEGACY" | null;
}

export async function overdueInvoices(): Promise<OverdueSummary> {
  const invoices = await prisma.invoice.findMany({
    where: { dueDate: { lt: new Date() } },
    select: { brand: true, venture: true, grossAmount: true, payments: { select: { amount: true } } },
  });
  const open = invoices
    .map((inv) => ({ ...inv, balance: inv.grossAmount - inv.payments.reduce((s, p) => s + p.amount, 0) }))
    .filter((inv) => inv.balance > 0.5);
  const ledgers = new Set(open.map((inv) => ledgerForInvoice(inv) ?? "LEGACY"));
  return {
    count: open.length,
    amount: Math.round(open.reduce((s, inv) => s + inv.balance, 0) * 100) / 100,
    onlyLedger: ledgers.size === 1 ? [...ledgers][0] : null,
  };
}
