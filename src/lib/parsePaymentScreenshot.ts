export interface ParsedPaymentScreenshot {
  amount: number | null;
  /** The figure was oddly written and nothing else on the screenshot confirms it. */
  amountUncertain: boolean;
  method: string | null;
  /** UPI reference / transaction id, handy to keep on the payment note. */
  reference: string | null;
  paidOn: string | null;
  /**
   * A payment gateway that keeps a commission, when the screenshot shows one.
   * Separate from `method`: a Razorpay checkout is still paid from PhonePe/GPay,
   * and both facts matter (where it came from, and who takes a cut).
   */
  gateway: "Razorpay" | null;
  /** The gateway's payment id, e.g. Razorpay's "pay_29QQoUBi66xm2f". */
  gatewayRef: string | null;
}

/**
 * Razorpay's own receipts and dashboard say "Razorpay" and carry a "pay_" id
 * (14 alphanumerics). A customer's UPI app often shows neither — the payee is
 * the merchant's name — so a miss here is expected and the form keeps a
 * manual switch.
 */
const RAZORPAY_ID = /\bpay_([A-Za-z0-9]{14})\b/;
const RAZORPAY_NAME = /razorpay|razor\s*pay|\brzp\b|via\s+razorpay/i;

export function detectGateway(text: string): { gateway: "Razorpay" | null; gatewayRef: string | null } {
  const id = RAZORPAY_ID.exec(text);
  if (id) return { gateway: "Razorpay", gatewayRef: `pay_${id[1]}` };
  if (RAZORPAY_NAME.test(text)) return { gateway: "Razorpay", gatewayRef: null };
  return { gateway: null, gatewayRef: null };
}

const APPS: Array<[RegExp, string]> = [
  [/phonepe|phone pe/i, "PhonePe"],
  [/google\s*pay|gpay|g\s*pay/i, "GPay"],
  [/paytm/i, "Paytm"],
  [/bhim/i, "BHIM UPI"],
  [/amazon\s*pay/i, "Amazon Pay"],
  [/cred\b/i, "CRED"],
  [/net\s*banking|imps|neft|rtgs/i, "Bank transfer"],
  // Last, so the UPI app a Razorpay checkout was paid from wins when shown.
  [/razorpay|razor\s*pay/i, "Razorpay"],
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
/** What OCR makes of a rupee sign glued to the figure, besides the sign itself. */
const SYMBOL_GLYPH = /[₹%€¥X*]|Rs\.?|INR/i;
/** Words that introduce a figure that isn't the payment. */
const NOT_THE_PAYMENT = /bal(?:ance)?|avl|available|limit|due|outstanding|cashback|reward|fee|charges?/i;

type Figure = {
  value: number;
  /** The digits were grouped the way rupees are printed (or not grouped at all). */
  wellFormed: boolean;
};

/**
 * Rupees from an OCR'd figure, or null if it isn't money.
 *
 * Tesseract's English alphabet has no ₹, so the symbol never survives: on the
 * receipts measured it came back as "%", as "X", and — worst — as a digit glued
 * to the figure, which turns ₹44,000 into a plausible-looking 344,000. That
 * last one is why `symbolFound` matters: with nothing else in front of the
 * digits, a leading digit that breaks Indian grouping is the rupee sign.
 */
function toFigure(token: string, symbolFound: boolean): Figure | null {
  // A time or a date is the number most easily mistaken for an amount.
  if (/\d\s*[:/]\s*\d/.test(token)) return null;

  // Letters OCR puts in place of digits, when they sit among digits: O/o for
  // 0, l/I/| for 1 ("15,0O0").
  const cleaned = token.replace(/(?<=[\d,.])[Oo](?=[\d,.]|$)|(?<=^|[\d,.])[Oo](?=[\d,.])/g, "0").replace(/(?<=[\d,.])[lI|](?=[\d,.])/g, "1");
  let digits = cleaned.replace(/^[^\d]+/, "").replace(/[^\d]+$/, "");
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

  // "15,0000" is no way to print a figure: a digit was doubled or a separator lost.
  const wellFormed = !digits.includes(",") || INDIAN_GROUPED.test(digits) || WESTERN_GROUPED.test(digits);
  const n = Number(`${digits.replace(/,/g, "")}${decimal ? `.${decimal[1]}` : ""}`);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? { value: n, wellFormed } : null;
}

/** The figure on the line printed largest, split into what OCR saw as separate words. */
function figureFromLine(line: string): Figure | null {
  const tokens = line.trim().split(/\s+/);
  // The amount is the longest run of digits on its line; anything shorter is a
  // stray "To", a time, or the tail of a name.
  const index = tokens.reduce(
    (best, token, i) =>
      (token.match(/\d/g)?.length ?? 0) > (tokens[best]?.match(/\d/g)?.length ?? 0) ? i : best,
    -1
  );
  if (index < 0) return null;
  // The largest print on a bank SMS or notification can be the balance.
  if (NOT_THE_PAYMENT.test(tokens.slice(Math.max(0, index - 3), index).join(" "))) return null;

  const token = tokens[index];
  const previous = tokens[index - 1];
  // "₹" survives OCR as a glyph of its own as often as it survives glued on:
  // a short wordless token in front of the figure is that glyph. A plus or
  // minus sign ("+₹15,000" on a credit) is not.
  const lead = /^[^\d]*/.exec(token)![0];
  const symbolFound =
    SYMBOL_GLYPH.test(lead) || (previous !== undefined && previous.length <= 3 && !/\d/.test(previous) && SYMBOL_GLYPH.test(previous));
  return toFigure(token, symbolFound);
}

/** What OCR turns "₹" into, alongside the symbol itself and the spelt-out forms. */
const RUPEE_CUE = /(?:₹|Rs\.?|INR|(?<![\w.])[%€¥X*])\s?([\d][\d.,]*)/gi;
const CUE_WORD = /(?:paid|amount|received|sent|debited|credited|deposited|transferred)\s*(?:of|with|by|for)?\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s?([\d][\d.,]*)/gi;

/**
 * Every figure the text introduces as money, in order — passing over any a
 * balance, limit or fee introduces. Balances sit next to the amount on plenty
 * of receipts and SMSes, and are often the bigger number.
 */
function moneyInText(text: string): number[] {
  const found: { at: number; value: number }[] = [];
  for (const pattern of [CUE_WORD, RUPEE_CUE]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      // Only what introduces this figure counts — a balance printed earlier on
      // the receipt must not disqualify the payment printed after it.
      const before = text.slice(0, match.index).split(/\s+/).slice(-3).join(" ");
      if (NOT_THE_PAYMENT.test(before)) continue;
      const figure = toFigure(match[1], true);
      if (figure?.wellFormed && !found.some((f) => Math.abs(f.value - figure.value) < 0.005)) {
        found.push({ at: match.index ?? 0, value: figure.value });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.value);
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Whether the big figure is a garbled copy of `value`: a zero doubled or a
 * decimal point lost (×10, ×100), or a ₹ read as a leading digit ("215000"
 * for 15000) — the misreads that turn ₹15,000 into ₹1,50,000.
 */
function garbled(big: number, value: number): boolean {
  if (same(big, value * 10) || same(big, value * 100)) return true;
  const b = String(Math.round(big));
  const v = String(Math.round(value));
  return b.length === v.length + 1 && b.slice(1) === v;
}

/**
 * The payment's amount. The figure printed largest is usually it (every
 * payment app prints the amount several times bigger than anything else), but
 * it's checked against the figures the text itself introduces as money: when
 * they disagree in one of the ways OCR garbles a figure, the text wins. A
 * figure nothing confirms and that's oddly written is returned, flagged.
 */
function pickAmount(text: string, amountLine?: string | null): { amount: number | null; uncertain: boolean } {
  const big = amountLine ? figureFromLine(amountLine) : null;
  const inText = moneyInText(text);
  if (big) {
    if (inText.some((v) => same(v, big.value))) return { amount: big.value, uncertain: false };
    const fix = inText.find((v) => garbled(big.value, v));
    if (fix !== undefined) return { amount: fix, uncertain: false };
    if (big.wellFormed) return { amount: big.value, uncertain: false };
    // A malformed big figure and nothing to check it against: say so.
    if (inText.length === 0) return { amount: big.value, uncertain: true };
  }
  return { amount: inText[0] ?? null, uncertain: false };
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

  const { amount, uncertain: amountUncertain } = pickAmount(text, amountLine);

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

  return { amount, amountUncertain, method, reference, paidOn, ...detectGateway(text) };
}
