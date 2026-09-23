import { calculateInvoiceBreakup } from "./invoiceCalc";
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

const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** [start, end) of a period, on the Indian financial year (April–March) and its quarters. */
export function gstPeriodRange(key: GstPeriodKey, now: Date): { start: Date; end: Date } {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
  switch (key) {
    case "month":
      return { start: monthStart, end: addMonths(monthStart, 1) };
    case "lastmonth":
      return { start: addMonths(monthStart, -1), end: monthStart };
    case "quarter": {
      const start = addMonths(monthStart, -(((now.getMonth() + 9) % 12) % 3));
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
  venture: string | null;
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** One invoice's tax, split exactly as its printed document splits it. */
export function gstLine(inv: GstInvoiceInput): GstLine {
  const gstin = inv.customerGstin?.trim() || null;
  const interState = isInterStateSupply(gstin);
  const b = calculateInvoiceBreakup({ grossAmount: inv.grossAmount, gstPercent: inv.gstPercent, qty: inv.qty, isInterState: interState });
  const tax = round2(b.cgstAmount + b.sgstAmount + b.igstAmount);
  return {
    ...inv,
    customerGstin: gstin,
    month: monthOf(inv.invoiceDate),
    b2b: Boolean(gstin),
    interState,
    taxable: b.subTotal,
    cgst: b.cgstAmount,
    sgst: b.sgstAmount,
    igst: b.igstAmount,
    tax,
    adjustment: b.adjustment,
    value: inv.grossAmount,
  };
}

export const emptyTotals = (): GstTotals => ({ count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, value: 0 });

export function sumLines(lines: GstLine[]): GstTotals {
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

export interface GstMonth {
  month: string;
  b2b: GstTotals;
  b2c: GstTotals;
  all: GstTotals;
}

/** Month-by-month totals, oldest first, each split B2B / B2C. */
export function monthlySummary(lines: GstLine[]): GstMonth[] {
  const months = [...new Set(lines.map((l) => l.month))].sort();
  return months.map((month) => {
    const inMonth = lines.filter((l) => l.month === month);
    return {
      month,
      b2b: sumLines(inMonth.filter((l) => l.b2b)),
      b2c: sumLines(inMonth.filter((l) => !l.b2b)),
      all: sumLines(inMonth),
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
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
