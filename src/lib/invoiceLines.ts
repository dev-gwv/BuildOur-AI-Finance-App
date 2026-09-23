import { calculateInvoiceBreakup, type InvoiceBreakup, type TaxMode } from "./invoiceCalc";

// Pure maths for multi-line invoices. Each line is GST-inclusive and has its
// own rate; tax is backed out per line (exactly as a single-line invoice
// always was), then summed. The HSN summary is what GSTR-1 Table 12 asks for.

export interface LineInput {
  description: string;
  hsnSac: string;
  qty: number;
  /** This line's total, GST included. */
  grossAmount: number;
  gstPercent: number;
}

export interface ComputedLine extends LineInput {
  breakup: InvoiceBreakup;
}

export interface HsnRow {
  hsnSac: string;
  gstPercent: number;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  taxMode: TaxMode;
  subTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  adjustment: number;
  total: number;
  hsnSummary: HsnRow[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeInvoice(lines: LineInput[], opts: { isInterState: boolean; gstRegistered?: boolean }): InvoiceTotals {
  const registered = opts.gstRegistered ?? true;
  const computed = lines.map((l) => ({
    ...l,
    breakup: calculateInvoiceBreakup({
      grossAmount: l.grossAmount,
      gstPercent: registered ? l.gstPercent : 0,
      qty: l.qty || 1,
      isInterState: opts.isInterState,
    }),
  }));
  const sum = (f: (b: InvoiceBreakup) => number) => round2(computed.reduce((s, l) => s + f(l.breakup), 0));

  const hsn = new Map<string, HsnRow>();
  for (const l of computed) {
    const rate = registered ? l.gstPercent : 0;
    const key = `${l.hsnSac}|${rate}`;
    const row = hsn.get(key) ?? { hsnSac: l.hsnSac, gstPercent: rate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    row.qty = round2(row.qty + (l.qty || 1));
    row.taxable = round2(row.taxable + l.breakup.subTotal);
    row.cgst = round2(row.cgst + l.breakup.cgstAmount);
    row.sgst = round2(row.sgst + l.breakup.sgstAmount);
    row.igst = round2(row.igst + l.breakup.igstAmount);
    row.total = round2(row.total + l.grossAmount);
    hsn.set(key, row);
  }

  const modes = new Set(computed.map((l) => l.breakup.taxMode));
  const taxMode: TaxMode = modes.has("IGST") ? "IGST" : modes.has("CGST_SGST") ? "CGST_SGST" : "NONE";

  return {
    lines: computed,
    taxMode,
    subTotal: sum((b) => b.subTotal),
    cgst: sum((b) => b.cgstAmount),
    sgst: sum((b) => b.sgstAmount),
    igst: sum((b) => b.igstAmount),
    adjustment: sum((b) => b.adjustment),
    total: round2(computed.reduce((s, l) => s + l.grossAmount, 0)),
    hsnSummary: [...hsn.values()],
  };
}

/**
 * The single-value columns kept on Invoice for lists, emails and search:
 * first line's description (or "N items"), HSN and rate, and the total.
 */
export function invoiceSummaryFields(lines: LineInput[]): {
  itemDescription: string;
  hsnSac: string;
  qty: number;
  grossAmount: number;
  gstPercent: number;
} {
  const first = lines[0];
  return {
    itemDescription: lines.length === 1 ? first.description : `${first.description} + ${lines.length - 1} more`,
    hsnSac: first.hsnSac,
    qty: lines.length === 1 ? first.qty : round2(lines.reduce((s, l) => s + (l.qty || 1), 0)),
    grossAmount: round2(lines.reduce((s, l) => s + l.grossAmount, 0)),
    gstPercent: first.gstPercent,
  };
}

// --- Balance --------------------------------------------------------------------

export interface BalanceInput {
  grossAmount: number;
  status: string;
  creditNotes: { grossAmount: number }[];
  payments: { amount: number; kind?: string | null; tdsAmount?: number | null }[];
}

export interface Balance {
  /** What the customer owes in total: invoice − credit notes (0 if cancelled). */
  net: number;
  credited: number;
  /** Receipts (TDS included — it settles the invoice). */
  received: number;
  refunded: number;
  tds: number;
  /** Still to collect (never negative). */
  balance: number;
  /** Paid more than is now owed, after a credit note: to hand back. */
  toRefund: number;
  settled: boolean;
  cancelled: boolean;
}

/**
 * The one definition of what an invoice still needs, used by every list,
 * card, alert and report so they can never disagree.
 */
export function invoiceBalance(inv: BalanceInput): Balance {
  const cancelled = inv.status === "CANCELLED";
  const credited = round2(inv.creditNotes.reduce((s, c) => s + c.grossAmount, 0));
  const received = round2(inv.payments.filter((p) => p.kind !== "REFUND").reduce((s, p) => s + p.amount, 0));
  const refunded = round2(inv.payments.filter((p) => p.kind === "REFUND").reduce((s, p) => s + p.amount, 0));
  const tds = round2(inv.payments.filter((p) => p.kind !== "REFUND").reduce((s, p) => s + (p.tdsAmount ?? 0), 0));
  const net = cancelled ? 0 : round2(Math.max(0, inv.grossAmount - credited));
  const settledAmount = round2(received - refunded);
  const diff = round2(net - settledAmount);
  return {
    net,
    credited,
    received,
    refunded,
    tds,
    balance: Math.max(0, diff),
    toRefund: Math.max(0, -diff),
    settled: diff <= 0.5,
    cancelled,
  };
}
