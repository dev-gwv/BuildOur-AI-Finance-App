import { todayISO } from "./dates";
import { calculateInvoiceBreakup } from "./invoiceCalc";
import { computeInvoice, type HsnRow, type LineInput } from "./invoiceLines";
import { isInterStateSupply } from "./gstState";

// Output GST, laid out the way GSTR-1 asks for it: per invoice, then per month
// and B2B/B2C. Pure so the numbers can be checked without a database; the
// page and the Excel export both build on it.

export type GstPeriodKey = "month" | "lastmonth" | "quarter" | "fy" | "lastfy";

export const GST_PERIODS: { key: GstPeriodKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This FY" },
  { key: "lastfy", label: "Last FY" },
];

export function parseGstPeriod(value: string | undefined): GstPeriodKey {
  return GST_PERIODS.some((p) => p.key === value) ? (value as GstPeriodKey) : "month";
}

// Built in UTC, like the stored dates (calendar days at midnight UTC), so the
// boundaries are the same whatever timezone the server runs in.
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

/**
 * [start, end) of a period, on the Indian financial year (April–March) and its
 * quarters. "Now" is read on the Indian calendar: just after midnight IST on
 * the 1st is already the new month.
 */
export function gstPeriodRange(key: GstPeriodKey, now: Date): { start: Date; end: Date } {
  const [y, m] = todayISO(now).split("-").map(Number);
  const month = m - 1;
  const monthStart = new Date(Date.UTC(y, month, 1));
  const fyStart = new Date(Date.UTC(month >= 3 ? y : y - 1, 3, 1));
  switch (key) {
    case "month":
      return { start: monthStart, end: addMonths(monthStart, 1) };
    case "lastmonth":
      return { start: addMonths(monthStart, -1), end: monthStart };
    case "quarter": {
      const start = addMonths(monthStart, -(((month + 9) % 12) % 3));
      return { start, end: addMonths(start, 3) };
    }
    case "fy":
      return { start: fyStart, end: addMonths(fyStart, 12) };
    case "lastfy":
      return { start: addMonths(fyStart, -12), end: fyStart };
  }
}

export interface GstInvoiceInput {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  grossAmount: number;
  gstPercent: number;
  qty: number;
  /** Name of the business that raised it, for the detail tables. */
  business: string;
  /** Its line items; tax is worked out per line at each line's rate. Absent = one line from the fields above. */
  lines?: LineInput[];
}

export interface GstLine extends GstInvoiceInput {
  /** YYYY-MM of the invoice date — the return period it's reported in. */
  month: string;
  /** Has a GSTIN, so it's reported invoice-by-invoice (B2B) rather than in aggregate. */
  b2b: boolean;
  interState: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  /** Paise lost to rounding the back-calculation, so the parts still add up to the value. */
  adjustment: number;
  value: number;
  /** Per HSN/SAC code and rate, for GSTR-1 Table 12. */
  hsn: HsnRow[];
}

export interface GstTotals {
  count: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  value: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** One invoice's tax, split exactly as its printed document splits it. */
export function gstLine(inv: GstInvoiceInput): GstLine {
  const gstin = inv.customerGstin?.trim() || null;
  const interState = isInterStateSupply(gstin, inv.placeOfSupply);
  const lines: LineInput[] = inv.lines?.length
    ? inv.lines
    : [{ description: "", hsnSac: "", qty: inv.qty, grossAmount: inv.grossAmount, gstPercent: inv.gstPercent }];
  const t = computeInvoice(lines, { isInterState: interState });
  return {
    ...inv,
    customerGstin: gstin,
    month: monthOf(inv.invoiceDate),
    b2b: Boolean(gstin),
    interState,
    taxable: t.subTotal,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    tax: round2(t.cgst + t.sgst + t.igst),
    adjustment: t.adjustment,
    value: t.total,
    hsn: t.hsnSummary,
  };
}

export const emptyTotals = (): GstTotals => ({ count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, value: 0 });

type Summable = Pick<GstLine, "taxable" | "cgst" | "sgst" | "igst" | "tax" | "value">;

export function sumLines(lines: Summable[]): GstTotals {
  const t = lines.reduce<GstTotals>(
    (acc, l) => ({
      count: acc.count + 1,
      taxable: acc.taxable + l.taxable,
      cgst: acc.cgst + l.cgst,
      sgst: acc.sgst + l.sgst,
      igst: acc.igst + l.igst,
      tax: acc.tax + l.tax,
      value: acc.value + l.value,
    }),
    emptyTotals()
  );
  return {
    count: t.count,
    taxable: round2(t.taxable),
    cgst: round2(t.cgst),
    sgst: round2(t.sgst),
    igst: round2(t.igst),
    tax: round2(t.tax),
    value: round2(t.value),
  };
}

// --- Credit notes (GSTR-1 CDNR for B2B, CDNUR for B2C) -----------------------

export interface GstCreditNoteInput {
  id: string;
  number: string;
  noteDate: Date;
  reason: string;
  grossAmount: number;
  gstPercent: number;
  invoiceNumber: string;
  invoiceDate: Date;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  business: string;
  /** HSN/SAC of the invoice's main line, for the HSN summary. */
  hsnSac: string;
}

/** A credit note's tax, split on the same supply type as its invoice. Positive figures; they reduce output tax. */
export interface GstCreditLine extends GstCreditNoteInput {
  month: string;
  b2b: boolean;
  interState: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  value: number;
}

export function gstCreditLine(cn: GstCreditNoteInput): GstCreditLine {
  const gstin = cn.customerGstin?.trim() || null;
  const interState = isInterStateSupply(gstin, cn.placeOfSupply);
  const b = calculateInvoiceBreakup({ grossAmount: cn.grossAmount, gstPercent: cn.gstPercent, qty: 1, isInterState: interState });
  return {
    ...cn,
    customerGstin: gstin,
    month: monthOf(cn.noteDate),
    b2b: Boolean(gstin),
    interState,
    taxable: b.subTotal,
    cgst: b.cgstAmount,
    sgst: b.sgstAmount,
    igst: b.igstAmount,
    tax: round2(b.cgstAmount + b.sgstAmount + b.igstAmount),
    value: cn.grossAmount,
  };
}

/** Output less credit notes: what's actually payable as output tax. */
export function netOfCredits(output: GstTotals, credits: GstTotals): GstTotals {
  return {
    count: output.count,
    taxable: round2(output.taxable - credits.taxable),
    cgst: round2(output.cgst - credits.cgst),
    sgst: round2(output.sgst - credits.sgst),
    igst: round2(output.igst - credits.igst),
    tax: round2(output.tax - credits.tax),
    value: round2(output.value - credits.value),
  };
}

/**
 * GSTR-1 Table 12: taxable value and tax per HSN/SAC and rate, net of credit
 * notes (each attributed to its invoice's main HSN, at the note's rate).
 */
export function hsnSummary(lines: GstLine[], credits: GstCreditLine[] = []): HsnRow[] {
  const rows = new Map<string, HsnRow>();
  const add = (r: HsnRow, sign: 1 | -1) => {
    const key = `${r.hsnSac}|${r.gstPercent}`;
    const row = rows.get(key) ?? { hsnSac: r.hsnSac, gstPercent: r.gstPercent, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    row.qty = round2(row.qty + sign * r.qty);
    row.taxable = round2(row.taxable + sign * r.taxable);
    row.cgst = round2(row.cgst + sign * r.cgst);
    row.sgst = round2(row.sgst + sign * r.sgst);
    row.igst = round2(row.igst + sign * r.igst);
    row.total = round2(row.total + sign * r.total);
    rows.set(key, row);
  };
  for (const l of lines) for (const h of l.hsn) add(h, 1);
  for (const c of credits) {
    add({ hsnSac: c.hsnSac, gstPercent: c.gstPercent, qty: 0, taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst, total: c.value }, -1);
  }
  return [...rows.values()].sort((a, b) => a.hsnSac.localeCompare(b.hsnSac) || a.gstPercent - b.gstPercent);
}

export interface GstMonth {
  month: string;
  b2b: GstTotals;
  b2c: GstTotals;
  all: GstTotals;
  /** Credit notes dated in the month (they reduce its output tax). */
  credits: GstTotals;
  /** Output less credit notes. */
  net: GstTotals;
}

/** Month-by-month totals, oldest first, each split B2B / B2C, with that month's credit notes. */
export function monthlySummary(lines: GstLine[], creditLines: GstCreditLine[] = []): GstMonth[] {
  const months = [...new Set([...lines.map((l) => l.month), ...creditLines.map((c) => c.month)])].sort();
  return months.map((month) => {
    const inMonth = lines.filter((l) => l.month === month);
    const all = sumLines(inMonth);
    const credits = sumLines(creditLines.filter((c) => c.month === month));
    return {
      month,
      b2b: sumLines(inMonth.filter((l) => l.b2b)),
      b2c: sumLines(inMonth.filter((l) => !l.b2b)),
      all,
      credits,
      net: netOfCredits(all, credits),
    };
  });
}

export interface InputGst {
  /** GST paid on costs (money-out expenses), claimable as input tax credit. */
  costs: number;
  /** GST a payment gateway charged on its commission — also creditable. */
  gatewayFees: number;
  total: number;
}

export function inputGst(costGst: number[], feeGst: number[]): InputGst {
  const costs = round2(costGst.reduce((s, n) => s + n, 0));
  const gatewayFees = round2(feeGst.reduce((s, n) => s + n, 0));
  return { costs, gatewayFees, total: round2(costs + gatewayFees) };
}

/** Output tax less input credit. Negative means credit carried forward. */
export function netGstPayable(output: GstTotals, input: InputGst): number {
  return round2(output.tax - input.total);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}
