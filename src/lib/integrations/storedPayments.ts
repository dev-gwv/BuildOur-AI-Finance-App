import { prisma } from "@/lib/prisma";
import type { ImportProvider } from "@/lib/gatewayImport";

/**
 * Payments from a gateway's uploaded reports, in the shape its API client
 * returns, so everything that reads payments (pickers, the Razorpay lookup by
 * amount and date, the fee update) works the same either way.
 */
export type StoredPayment = {
  id: string;
  status: string;
  amount: number;
  feeAmount: number;
  feeGstAmount: number;
  netAmount: number;
  gstAmount: number;
  method: string | null;
  paidOn: string;
  createdAt: string;
  name: string | null;
  email: string | null;
  contact: string | null;
  vpa: string | null;
  description: string | null;
  reference: null;
  currency: "INR";
  refunded: number;
};

type Row = Awaited<ReturnType<typeof prisma.gatewayTransaction.findFirstOrThrow>>;

function toPayment(r: Row): StoredPayment {
  const ist = new Date(r.paidAt.getTime() + 330 * 60_000);
  return {
    id: r.externalId,
    // A refunded payment still came in; the refund is recorded on the invoice.
    status: "captured",
    amount: r.amount,
    feeAmount: r.feeAmount,
    feeGstAmount: r.feeGstAmount,
    netAmount: Math.round((r.amount - r.feeAmount - r.feeGstAmount) * 100) / 100,
    gstAmount: r.gstAmount ?? 0,
    method: r.method,
    paidOn: ist.toISOString().slice(0, 10),
    createdAt: r.paidAt.toISOString(),
    name: r.name,
    email: r.email,
    contact: r.contact,
    vpa: r.vpa,
    description: r.description,
    reference: null,
    currency: "INR",
    refunded: 0,
  };
}

/** Uploaded payments made between two days (YYYY-MM-DD, IST, inclusive), newest first. */
export async function storedPaymentsBetween(provider: ImportProvider, fromDay: string, toDay: string, max = 2000): Promise<StoredPayment[]> {
  const rows = await prisma.gatewayTransaction.findMany({
    where: {
      provider,
      paidAt: { gte: new Date(`${fromDay}T00:00:00+05:30`), lte: new Date(`${toDay}T23:59:59.999+05:30`) },
    },
    orderBy: { paidAt: "desc" },
    take: max,
  });
  return rows.map(toPayment);
}

export async function storedPayment(provider: ImportProvider, externalId: string): Promise<StoredPayment | null> {
  const row = await prisma.gatewayTransaction.findUnique({ where: { provider_externalId: { provider, externalId } } });
  return row ? toPayment(row) : null;
}

/** How much has been uploaded for a gateway: shown on its settings card. */
export async function importStats(provider: ImportProvider) {
  const [count, newest, lastImport] = await Promise.all([
    prisma.gatewayTransaction.count({ where: { provider } }),
    prisma.gatewayTransaction.findFirst({ where: { provider }, orderBy: { paidAt: "desc" }, select: { paidAt: true } }),
    prisma.gatewayTransaction.findFirst({ where: { provider }, orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
  ]);
  return {
    count,
    newestPayment: newest?.paidAt.toISOString() ?? null,
    lastImport: lastImport?.importedAt.toISOString() ?? null,
  };
}

/** The newest uploaded payment's date, so a picker can say how far the reports go. */
export async function newestStoredPayment(provider: ImportProvider): Promise<string | null> {
  const row = await prisma.gatewayTransaction.findFirst({ where: { provider }, orderBy: { paidAt: "desc" }, select: { paidAt: true } });
  return row ? new Date(row.paidAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;
}
