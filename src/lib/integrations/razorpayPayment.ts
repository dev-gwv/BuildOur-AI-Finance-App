// Pure: Razorpay's payment object -> what the app records. Kept apart from the
// API client (which needs the database for credentials) so it can be tested.

/** A Razorpay payment reduced to what the app records. Money is in rupees. */
export interface RazorpayPayment {
  id: string;
  status: string;
  /** What the customer paid. */
  amount: number;
  /** Razorpay's commission, excluding the GST on it. */
  feeAmount: number;
  /** GST Razorpay charged on its commission. */
  feeGstAmount: number;
  /** What settles into the bank. */
  netAmount: number;
  /** upi / card / netbanking / wallet ... */
  method: string | null;
  /** YYYY-MM-DD (IST) the payment was made. */
  paidOn: string;
  createdAt: string;
  email: string | null;
  contact: string | null;
  vpa: string | null;
  description: string | null;
  /** Bank reference (UPI RRN), when Razorpay has one. */
  reference: string | null;
}

export type RawPayment = {
  id: string;
  status: string;
  amount: number;
  fee?: number | null;
  tax?: number | null;
  method?: string | null;
  created_at: number;
  email?: string | null;
  contact?: string | null;
  vpa?: string | null;
  description?: string | null;
  acquirer_data?: { rrn?: string | null; upi_transaction_id?: string | null } | null;
};

const paise = (n: number | null | undefined) => Math.round(n ?? 0) / 100;

export function normalizeRazorpayPayment(p: RawPayment): RazorpayPayment {
  // Razorpay's `fee` already includes `tax`; split them so the GST on the
  // commission can be claimed as input credit.
  const fee = paise(p.fee);
  const tax = paise(p.tax);
  const amount = paise(p.amount);
  const created = new Date(p.created_at * 1000);
  const ist = new Date(created.getTime() + 330 * 60_000);
  return {
    id: p.id,
    status: p.status,
    amount,
    feeAmount: Math.round((fee - tax) * 100) / 100,
    feeGstAmount: tax,
    netAmount: Math.round((amount - fee) * 100) / 100,
    method: p.method ?? null,
    paidOn: ist.toISOString().slice(0, 10),
    createdAt: created.toISOString(),
    email: p.email ?? null,
    contact: p.contact ?? null,
    vpa: p.vpa ?? null,
    description: p.description ?? null,
    reference: p.acquirer_data?.rrn ?? p.acquirer_data?.upi_transaction_id ?? null,
  };
}

