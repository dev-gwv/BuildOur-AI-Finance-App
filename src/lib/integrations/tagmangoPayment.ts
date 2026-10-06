// Pure: a TagMango transaction -> what the app records. Kept apart from the
// API client (which needs the database for credentials) so it can be tested.

/** A TagMango transaction reduced to what the app records. Money is in rupees. */
export interface TagMangoPayment {
  id: string;
  /** "captured" for a completed payment, as Razorpay's are, so both pick the same way. */
  status: string;
  /** What the customer was charged, GST included. */
  amount: number;
  /** The GST inside `amount`. */
  gstAmount: number;
  /** TagMango's commission, excluding the GST on it. */
  feeAmount: number;
  /** GST TagMango charged on its commission. */
  feeGstAmount: number;
  /** onetime / recurring / flexipay */
  method: string | null;
  /** YYYY-MM-DD (IST). */
  paidOn: string;
  createdAt: string;
  name: string | null;
  email: string | null;
  contact: string | null;
  vpa: null;
  /** The Mango (course / product) bought. */
  description: string | null;
  currency: string;
  refunded: number;
}

export type RawTagMangoTransaction = {
  id: string;
  occurredAt: string;
  status: string;
  customer?: { name?: string | null; email?: string | null; phone?: number | string | null } | null;
  mango?: { title?: string | null } | null;
  payment?: { type?: string | null; chargedAmount?: number | null; currency?: string | null; gstAmount?: number | null } | null;
  commission?: { totalAmountIncludingGst?: number | null; reportedGstAmount?: number | null } | null;
  refund?: { amount?: number | null } | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function normalizeTagMangoTransaction(t: RawTagMangoTransaction): TagMangoPayment {
  const amount = r2(t.payment?.chargedAmount ?? 0);
  const commission = t.commission?.totalAmountIncludingGst ?? 0;
  const commissionGst = t.commission?.reportedGstAmount ?? 0;
  const at = new Date(t.occurredAt);
  const ist = new Date(at.getTime() + 330 * 60_000);
  return {
    id: t.id,
    status: t.status === "completed" ? "captured" : t.status,
    amount,
    gstAmount: r2(t.payment?.gstAmount ?? 0),
    feeAmount: r2(commission - commissionGst),
    feeGstAmount: r2(commissionGst),
    method: t.payment?.type ?? null,
    paidOn: ist.toISOString().slice(0, 10),
    createdAt: at.toISOString(),
    name: t.customer?.name?.trim() || null,
    email: t.customer?.email?.trim() || null,
    contact: t.customer?.phone != null && String(t.customer.phone).trim() ? String(t.customer.phone).trim() : null,
    vpa: null,
    description: t.mango?.title?.trim() || null,
    currency: t.payment?.currency ?? "INR",
    refunded: r2(t.refund?.amount ?? 0),
  };
}

/**
 * The dashboard address TagMango identifies a creator by ("x-whitelabel-host"):
 * "https://learn.example.com/dashboard" -> "learn.example.com". Null if it
 * isn't a host name.
 */
export function normalizeTagMangoHost(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}
