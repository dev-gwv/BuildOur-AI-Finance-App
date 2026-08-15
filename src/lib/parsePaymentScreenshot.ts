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

/** "1,70,000" — how every Indian payment app prints a figure. */
const INDIAN_GROUPED = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
/** "170,000" — what bank sites and statements print instead. */
const WESTERN_GROUPED = /^\d{1,3}(?:,\d{3})+$/;

/**
 * Rupees from an OCR'd figure, or null if it isn't money.
 *
 * Tesseract's English alphabet has no ₹, so the symbol never survives: on the
 * receipts measured it came back as "%", as "X", and — worst — as a digit glued
 * to the figure, which turns ₹44,000 into a plausible-looking 344,000. That
 * last one is why `symbolFound` matters: with nothing else in front of the
 * digits, a leading digit that breaks Indian grouping is the rupee sign.
 */
function toAmount(token: string, symbolFound: boolean): number | null {
  // A time or a date is the number most easily mistaken for an amount.
  if (/\d\s*[:/]\s*\d/.test(token)) return null;

  let digits = token.replace(/^[^\d]+/, "").replace(/[^\d]+$/, "");
  if (!digits) return null;
  // OCR reads the thousands separator as a comma or a full stop interchangeably.
  const decimal = /[.,](\d{1,2})$/.exec(digits);
  if (decimal) digits = digits.slice(0, -decimal[0].length);
  digits = digits.replace(/\./g, ",");

  if (!symbolFound && WESTERN_GROUPED.test(digits) && !INDIAN_GROUPED.test(digits)) {
    // ponytail: only catches a swallowed ₹ when dropping it restores Indian
    // grouping. ₹4,40,000 read as "34,40,000" stays wrong — it reads as a
    // valid figure — but lands far over the balance due, which is flagged.
    const withoutSymbol = digits.slice(1);
    if (INDIAN_GROUPED.test(withoutSymbol)) digits = withoutSymbol;
  }

  const n = Number(`${digits.replace(/,/g, "")}${decimal ? `.${decimal[1]}` : ""}`);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? n : null;
}

/** The line the figure is printed on, split into what OCR saw as separate words. */
function amountFromLine(line: string): number | null {
  const tokens = line.trim().split(/\s+/);
  // The amount is the longest run of digits on its line; anything shorter is a
  // stray "To", a time, or the tail of a name.
  const index = tokens.reduce(
    (best, token, i) =>
      (token.match(/\d/g)?.length ?? 0) > (tokens[best]?.match(/\d/g)?.length ?? 0) ? i : best,
    -1
  );
  if (index < 0) return null;

  const token = tokens[index];
  const previous = tokens[index - 1];
  // "₹" survives OCR as a glyph of its own as often as it survives glued on:
  // a short wordless token in front of the figure is that glyph.
  const symbolFound =
    /^\D/.test(token) || (previous !== undefined && previous.length <= 3 && !/\d/.test(previous));
  return toAmount(token, symbolFound);
}

/** What OCR turns "₹" into, alongside the symbol itself and the spelt-out forms. */
const RUPEE_CUE = /(?:₹|Rs\.?|INR|(?<![\w.])[%€¥X*])\s?([\d][\d.,]*)/gi;
const CUE_WORD = /(?:paid|amount|received|sent|debited|credited)\s*[:\-]?\s*([\d][\d.,]*)/gi;

/**
 * Falls back to scanning the flattened text, for when the OCR layout data
 * isn't there. Balances and limits sit next to the amount on plenty of
 * receipts, so a figure introduced as one of those is passed over.
 */
function amountFromText(text: string): number | null {
  for (const pattern of [RUPEE_CUE, CUE_WORD]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      // Only what introduces this figure counts — a balance printed earlier on
      // the receipt must not disqualify the payment printed after it.
      const before = text.slice(0, match.index).split(/\s+/).slice(-2).join(" ");
      if (/balance|available|limit|due|outstanding/i.test(before)) continue;
      const amount = toAmount(match[1], true);
      if (amount !== null) return amount;
    }
  }
  return null;
}

/**
 * Pulls what it can from OCR'd text of a UPI payment screenshot. Screenshots
 * vary by app and OCR is imperfect, so every field is a suggestion the user
 * confirms — nothing here is trusted blindly.
 *
 * `amountLine` is the line the figure was printed largest on. Every payment app
 * shows the amount several times the size of anything else, so that one line
 * settles which of a screenshot's numbers is the money — the transaction
 * reference, the masked account digits and the balance underneath are all
 * numbers too, and the figure alone can't be told apart from them.
 */
export function parsePaymentScreenshotText(
  raw: string,
  amountLine?: string | null
): ParsedPaymentScreenshot {
  const text = raw.replace(/\s+/g, " ");

  const amount = (amountLine ? amountFromLine(amountLine) : null) ?? amountFromText(text);

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
