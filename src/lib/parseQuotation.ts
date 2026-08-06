export interface ParsedQuotation {
  /** Total investment quoted, in rupees. */
  totalAmount: number | null;
  /** Couple/client the package is for, when it can be worked out. */
  clientName: string | null;
  /** Events listed in the package, used to draft the invoice line. */
  events: string[];
  /** First event date seen, ISO yyyy-mm-dd, as a sensible invoice date. */
  firstEventDate: string | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function toIso(day: string, mon: string, year: string): string | null {
  const m = MONTHS[mon.slice(0, 3).toLowerCase()];
  return m ? `${year}-${m}-${day.padStart(2, "0")}` : null;
}

/**
 * Reads a Mulberry Weddings package quotation. The deck is mostly design, so
 * only a few things are reliably in the text layer: the total investment, the
 * event list, and the shoot dates. Anything missing comes back null for the
 * user to fill in rather than being guessed at.
 */
export function parseQuotationText(text: string, fileName?: string): ParsedQuotation {
  // "Total Investment: INR 1,70,000/-" — the wording is consistent across decks.
  const amount =
    /Total\s+Investment\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text) ??
    /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*\/-/i.exec(text);

  // Each slide states the event twice (heading and detail line), often with a
  // slightly different suffix, so collapse to one entry per event keeping the
  // fullest wording.
  const byKey = new Map<string, string>();
  for (const m of text.matchAll(/Event\s*:\s*([^:]+?)\s*(?:Location|Date)\s*:/gi)) {
    const label = m[1].replace(/\s+/g, " ").trim();
    if (!label) continue;
    // Ignore the bracketed qualifier so "Vidai" and "Vidai ( Morning )" collapse.
    const key = label.replace(/\([^)]*\)/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const existing = byKey.get(key);
    if (!existing || label.length > existing.length) byKey.set(key, label);
  }
  const events = [...byKey.values()];

  const dateMatch = /Date\s*:?\s*(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/.exec(text);

  // The couple's name lives in the cover artwork, not the text layer, so fall
  // back to the file name the client sent — e.g. "Aman & Ruchika Wedding Package".
  let clientName: string | null = null;
  if (fileName) {
    const stem = fileName
      .replace(/\.pdf$/i, "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .replace(/\s*(wedding|package|quotation|quote|proposal)\b/gi, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stem) clientName = stem;
  }

  return {
    totalAmount: amount ? Number(amount[1].replace(/,/g, "")) : null,
    clientName,
    events,
    firstEventDate: dateMatch ? toIso(dateMatch[1], dateMatch[2], dateMatch[3]) : null,
  };
}

/** True when the text looks like a Mulberry package quotation. */
export function looksLikeQuotation(text: string): boolean {
  return /Total\s+Investment|Mulberry Weddings|Deliverables/i.test(text);
}
