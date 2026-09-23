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

export type TaxMode = "CGST_SGST" | "IGST" | "NONE";

export interface InvoiceBreakupInput {
  /** GST-inclusive total for the line item (what the customer's loan actually covers). */
  grossAmount: number;
  gstPercent: number;
  qty: number;
  /**
   * True for inter-state supply (customer state != seller home state 07 Delhi).
   * Derived from the first 2 digits of the customer's GSTIN — see src/lib/gstState.ts.
   */
  isInterState?: boolean;
}

export interface InvoiceBreakup {
  rate: number;
  subTotal: number;
  taxMode: TaxMode;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  igstPercent: number;
  igstAmount: number;
  adjustment: number;
  total: number;
}

// Back-calculates subtotal + tax from a GST-inclusive total.
// Intra-state (default, B2C or same-state GSTIN): splits evenly across CGST/SGST.
// Inter-state (customer GSTIN state != 07 Delhi): single IGST line at full rate.
export function calculateInvoiceBreakup({ grossAmount, gstPercent, qty, isInterState }: InvoiceBreakupInput): InvoiceBreakup {
  const subTotal = round2(grossAmount / (1 + gstPercent / 100));
  const rate = qty > 0 ? round2(subTotal / qty) : subTotal;

  if (gstPercent <= 0) {
    return {
      rate,
      subTotal,
      taxMode: "NONE",
      cgstPercent: 0,
      cgstAmount: 0,
      sgstPercent: 0,
      sgstAmount: 0,
      igstPercent: 0,
      igstAmount: 0,
      adjustment: 0,
      total: grossAmount,
    };
  }

  if (isInterState) {
    const igstAmount = round2(subTotal * (gstPercent / 100));
    const adjustment = round2(grossAmount - (subTotal + igstAmount));
    return {
      rate,
      subTotal,
      taxMode: "IGST",
      cgstPercent: 0,
      cgstAmount: 0,
      sgstPercent: 0,
      sgstAmount: 0,
      igstPercent: gstPercent,
      igstAmount,
      adjustment,
      total: grossAmount,
    };
  }

  const halfGst = gstPercent / 2;
  const cgstAmount = round2(subTotal * (halfGst / 100));
  const sgstAmount = cgstAmount;
  const adjustment = round2(grossAmount - (subTotal + cgstAmount + sgstAmount));

  return {
    rate,
    subTotal,
    taxMode: "CGST_SGST",
    cgstPercent: halfGst,
    cgstAmount,
    sgstPercent: halfGst,
    sgstAmount,
    igstPercent: 0,
    igstAmount: 0,
    adjustment,
    total: grossAmount,
  };
}
