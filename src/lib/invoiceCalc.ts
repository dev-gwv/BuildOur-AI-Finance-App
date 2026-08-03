function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
