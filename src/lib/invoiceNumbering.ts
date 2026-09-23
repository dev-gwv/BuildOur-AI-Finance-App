// Pure invoice-series maths, shared by the server (reserving numbers) and
// tests. A series is a business's prefix plus a 6-digit counter.

export function formatInvoiceNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/** What the next invoice will be numbered, for the form to show. Not reserved. */
export function previewInvoiceNumber(business: { invoicePrefix: string; invoiceNextNumber: number }): string {
  return formatInvoiceNumber(business.invoicePrefix, business.invoiceNextNumber);
}

/** The digits after a series prefix, or null if the number isn't in that series. */
export function seqInSeries(invoiceNumber: string, prefix: string): number | null {
  if (!invoiceNumber.toUpperCase().startsWith(prefix.toUpperCase())) return null;
  const digits = invoiceNumber.slice(prefix.length).replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}
