function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Totals what arrived on each platform, largest first. Instalments land across
 * several apps over months, so the per-platform figure is the one question the
 * payment list can't be read off by eye. Payments with no platform recorded are
 * grouped rather than dropped — money that arrived still counts.
 */
export function totalsByPlatform(
  payments: Array<{ amount: number; method: string | null }>
): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const p of payments) {
    const name = p.method?.trim() || "Not recorded";
    totals.set(name, round2((totals.get(name) ?? 0) + p.amount));
  }
  return [...totals.entries()].sort(([, a], [, b]) => b - a);
}

export interface InvoiceBreakupInput {
  /** GST-inclusive total for the line item (what the customer's loan actually covers). */
  grossAmount: number;
  gstPercent: number;
  qty: number;
}

export interface InvoiceBreakup {
  rate: number;
  subTotal: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  adjustment: number;
  total: number;
}

// Back-calculates subtotal + CGST/SGST from a GST-inclusive total, splitting the
// rate evenly across CGST/SGST (intra-state supply, matching the seller's own state).
export function calculateInvoiceBreakup({ grossAmount, gstPercent, qty }: InvoiceBreakupInput): InvoiceBreakup {
  const halfGst = gstPercent / 2;
  const subTotal = round2(grossAmount / (1 + gstPercent / 100));
  const cgstAmount = round2(subTotal * (halfGst / 100));
  const sgstAmount = cgstAmount;
  const adjustment = round2(grossAmount - (subTotal + cgstAmount + sgstAmount));
  const rate = qty > 0 ? round2(subTotal / qty) : subTotal;

  return {
    rate,
    subTotal,
    cgstPercent: halfGst,
    cgstAmount,
    sgstPercent: halfGst,
    sgstAmount,
    adjustment,
    total: grossAmount,
  };
}
