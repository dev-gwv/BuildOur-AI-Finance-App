export interface ParsedPaymentScreenshot {
  amount: number | null;
  method: string | null;
  /** UPI reference / transaction id, handy to keep on the payment note. */
  reference: string | null;
  paidOn: string | null;
}

const APPS: Array<[RegExp, string]> = [
  [/phonepe|phone pe/i, "PhonePe"],
  [/google\s*pay|gpay|g\s*pay/i, "GPay"],
  [/paytm/i, "Paytm"],
  [/bhim/i, "BHIM UPI"],
  [/amazon\s*pay/i, "Amazon Pay"],
  [/cred\b/i, "CRED"],
  [/net\s*banking|imps|neft|rtgs/i, "Bank transfer"],
];

/**
 * Every platform money can arrive on, for the payment form's suggestions. The
 * OCR-detectable ones come from APPS so a name can never drift between what a
 * screenshot fills in and what the user can pick — a mismatch would split one
 * platform's takings across two spellings in the totals.
 */
export const PAYMENT_METHODS: string[] = [
  ...APPS.map(([, label]) => label),
  "Cash",
  "Cheque",
];

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Pulls what it can from OCR'd text of a UPI payment screenshot. Screenshots
 * vary by app and OCR is imperfect, so every field is a suggestion the user
 * confirms — nothing here is trusted blindly.
 */
export function parsePaymentScreenshotText(raw: string): ParsedPaymentScreenshot {
  const text = raw.replace(/\s+/g, " ");

  // Amounts appear as "₹1,70,000", "Rs. 10000" or "INR 10,000.00". OCR often
  // reads ₹ as a stray character, so also accept a bare figure after a cue word.
  const amountMatch =
    /(?:₹|Rs\.?|INR)\s*([\d][\d,]*(?:\.\d{1,2})?)/i.exec(text) ??
    /(?:paid|amount|received|sent)\s*[:\-]?\s*([\d][\d,]*(?:\.\d{1,2})?)/i.exec(text);

  let amount: number | null = null;
  if (amountMatch) {
    const n = Number(amountMatch[1].replace(/,/g, ""));
    // Guard against OCR picking up a date or reference number as the amount.
    if (Number.isFinite(n) && n > 0 && n < 100_000_000) amount = n;
  }

  const method = APPS.find(([re]) => re.test(text))?.[1] ?? null;

  const reference =
    /(?:UTR|UPI\s*(?:transaction\s*)?(?:ID|Ref(?:erence)?)(?:\s*No\.?)?|Transaction\s*ID|Txn\s*ID)\s*[:\-]?\s*([A-Za-z0-9]{6,25})/i.exec(
      text
    )?.[1] ?? null;

  // "12 Aug 2026" / "12 August 2026", or a numeric dd/mm/yyyy.
  let paidOn: string | null = null;
  const named = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/.exec(text);
  const numeric = /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/.exec(text);
  if (named) {
    const m = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (m) paidOn = `${named[3]}-${m}-${named[1].padStart(2, "0")}`;
  } else if (numeric) {
    paidOn = `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }

  return { amount, method, reference, paidOn };
}
