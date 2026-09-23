// Pure invoice-series maths, shared by the server (reserving numbers), the
// forms (previewing them) and tests.
//
// A series is a prefix plus a zero-padded counter. A prefix containing {FY}
// ("IPC/{FY}/") gets the financial year filled in ("IPC/26-27/"), so every
// April starts a fresh series at 1 — as most Indian businesses number.

/** GST caps an invoice number at 16 characters. */
export const MAX_INVOICE_NUMBER_LENGTH = 16;

/** Indian financial year of a date, as "26-27" (April 2026 – March 2027). */
export function fyLabel(date: Date): string {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The prefix with {FY} filled in for the given date. */
export function resolvePrefix(prefix: string, date: Date): string {
  return prefix.replace(/\{FY\}/gi, fyLabel(date));
}

export function hasFyToken(prefix: string): boolean {
  return /\{FY\}/i.test(prefix);
}

export function formatInvoiceNumber(prefix: string, seq: number, digits = 6): string {
  return `${prefix}${String(seq).padStart(digits, "0")}`;
}

/** What the next invoice will be numbered, for the form to show. Not reserved. */
export function previewInvoiceNumber(
  business: { invoicePrefix: string; invoiceNextNumber: number; invoiceDigits?: number },
  opts: { date?: Date; fyNext?: number } = {}
): string {
  const date = opts.date ?? new Date();
  const digits = business.invoiceDigits ?? 6;
  if (hasFyToken(business.invoicePrefix)) {
    return formatInvoiceNumber(resolvePrefix(business.invoicePrefix, date), opts.fyNext ?? 1, digits);
  }
  return formatInvoiceNumber(business.invoicePrefix, business.invoiceNextNumber, digits);
}

/** The digits after a series prefix, or null if the number isn't in that series. */
export function seqInSeries(invoiceNumber: string, prefix: string): number | null {
  if (!invoiceNumber.toUpperCase().startsWith(prefix.toUpperCase())) return null;
  const digits = invoiceNumber.slice(prefix.length).replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

/** Longest number this series will produce, for validating settings against the 16-char cap. */
export function longestNumberFor(prefix: string, digits: number): number {
  return prefix.replace(/\{FY\}/gi, "26-27").length + digits;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}
