import { extractText } from "unpdf";
import { looksLikeGstCertificate, parseGstCertificateText, type ParsedGstCertificate } from "./parseGstCertificate";

export interface ParsedDeliveryOrder {
  doId: string | null;
  doDate: string | null; // ISO yyyy-mm-dd
  customerName: string | null;
  deliveryAddress: string | null;
  productPrice: number | null;
  /**
   * The rest of the DO's amount table. Bajaj letters its rows: A Product Price,
   * B Gross Loan Amount, C Net Loan Amount, E Advance EMI, ... Y DP from
   * Customer, Z Total Deductions, AA Net Disbursement. Null where a DO doesn't
   * print a row.
   */
  /** What the customer pays the dealer at delivery (row Y), Bajaj's charges included. */
  downPayment: number | null;
  /** What Bajaj lends: the Net Loan Amount (row C) when printed, else a plain "Loan Amount". */
  loanAmount: number | null;
  /** Monthly EMI (row P "Total EMI"). */
  emi: number | null;
  tenureMonths: number | null;
  mobile: string | null;
  /** Row B: before the advance EMIs come off. */
  grossLoanAmount: number | null;
  /** Row C: what Bajaj finances, before its deductions. */
  netLoanAmount: number | null;
  /** Row AA: what Bajaj pays into the bank. */
  netDisbursement: number | null;
  /** Row Z. */
  totalDeductions: number | null;
  /** Row E, and how many EMIs it is (the "12/2" in the scheme code). */
  advanceEmi: number | null;
  advanceEmis: number | null;
  /** Row H: the interest the dealer subsidises, and its % of the loan. */
  dealerSubsidy: number | null;
  dealerSubsidyPercent: number | null;
  /**
   * Bajaj's own charges, which the customer pays the dealer inside the down
   * payment and Bajaj takes back out of the payout: upfront interest (G),
   * service charge (F), card charges (J), mandate (V), convenience fee (W).
   */
  bajajCharges: number | null;
  /** Row U: the GST inside what Bajaj charges the dealer. */
  totalGst: number | null;
}

export type ParsedDocument =
  | ({ docType: "DO" } & ParsedDeliveryOrder)
  | ({ docType: "GST" } & ParsedGstCertificate);

function match(re: RegExp, text: string): string | null {
  return re.exec(text)?.[1]?.trim() ?? null;
}

function toIsoDate(ddmmyyyy: string | null): string | null {
  const m = ddmmyyyy && /(\d{2})\/(\d{2})\/(\d{4})/.exec(ddmmyyyy);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** A rupee figure after a label: tolerates a row letter, ":", "|", "[", ₹/Rs/INR and OCR noise. */
const AMOUNT_TAIL = /[^\d\n]{0,16}?(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/.source;

function amountAfter(label: RegExp, text: string): number | null {
  const re = new RegExp(`(?:^|[^A-Za-z])(?:${label.source})${AMOUNT_TAIL}`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A lettered row of the DO's table: "C Net Loan Amount 98334 98334". The label
 * can carry a note in brackets ("Card Charges (EMI, Add on Card) 530"), so a
 * wider gap than amountAfter's is allowed — every row prints a figure, so it
 * can't run on into the next row's. The formulas under the table ("Net
 * Disbursement(AA) = A+X…") come after the rows, and the first match wins.
 */
function row(label: RegExp, text: string): number | null {
  const re = new RegExp(`(?:^|[^A-Za-z])(?:${label.source})(?!\\s*\\()[^\\d\\n]{0,40}?(-?[\\d,]+(?:\\.\\d{1,2})?)`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Bracketed labels: a note in brackets is part of the label, not a formula. */
function labelled(label: RegExp, text: string): number | null {
  const re = new RegExp(`(?:^|[^A-Za-z])(?:${label.source})[^\\d\\n]{0,40}?(-?[\\d,]+(?:\\.\\d{1,2})?)`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const sum = (...xs: (number | null)[]) => {
  const present = xs.filter((x): x is number => x !== null);
  return present.length ? Math.round(present.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};

/**
 * Extracts the fields we need from Bajaj Finance's standard Delivery Order.
 * It's a fixed layout across deals, so plain regex on the flattened text is
 * enough — no generic PDF-layout parsing required.
 */
export function parseDeliveryOrderText(text: string): ParsedDeliveryOrder {
  // Decimals are optional: the amount varies per deal and isn't always written
  // as "1,17,999.00" — some DOs state a round figure like "1,77,000".
  // Spacing and colons are optional so a photographed DO read by OCR still
  // matches ("DO ID : B42…", "Product Price ₹ 1,17,999").
  // OCR of a photographed DO reads the price table's borders as "[", "|" or
  // ":" between the label and the figure, so allow a few non-digits there.
  const priceMatch = /Product\s*Price[^\d\n]{0,12}?(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/.exec(text);

  const netLoanAmount = row(/Net\s*Loan\s*Amount/, text);
  const dpFromCustomer = row(/DP\s*from\s*Customer(?!\s*through)/, text);
  const totalEmi = row(/Total\s*EM[Il1]/, text);
  // "Scheme Code (GT/AE) 5002445 (12/2)": 12 months, 2 of them paid up front.
  const scheme = /Scheme\s*Code[^()]*\([^)]*\)\s*\d+\s*\(\s*(\d{1,3})\s*\/\s*(\d{1,2})\s*\)/i.exec(text);
  const subsidy = /Dealer\s*Interest\s*Subsidy[^\d\n]{0,24}?[\d,]+(?:\.\d+)?\s*\(\s*([\d.]+)\s*%\s*\)/i.exec(text);

  return {
    doId: match(/DO\s*ID\s*:?\s*([A-Z0-9]{6,})/, text),
    doDate: toIsoDate(match(/Date\s*:?\s*(\d{2}\/\d{2}\/\d{4})/, text)),
    customerName: match(/loan application of Mr\/Miss\/Mrs\.\s*([A-Za-z.\s]+?)\s+has been approved/, text),
    deliveryAddress: match(/Address of the customer for delivery:\s*(.+?)\s*Mobile Number:/, text),
    productPrice: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
    // Bajaj's "DP from Customer" row; other DOs say "Down Payment". (Not "Margin
    // Money": that's price − gross loan, usually 0, and printed before it.)
    downPayment: dpFromCustomer ?? amountAfter(/Down\s*Payment|Advance\s*EMI|Margin\s*Money/, text),
    // The net loan is what Bajaj finances; "Gross Loan Amount" comes first on
    // the page and must not be taken for it.
    loanAmount: netLoanAmount ?? amountAfter(/(?<!Gross\s)Loan\s*Amount|Finance\s*Amount|Amount\s*Financed|Financed\s*Amount/, text),
    // OCR reads the capital I in "EMI" as l or 1. "Advance EMI" is the EMIs paid up front, not the monthly one.
    emi: totalEmi ?? amountAfter(/EM[Il1]\s*Amount|Monthly\s*EM[Il1]|(?<!Advance\s)EM[Il1](?!\s*(?:Start|Date|Card|Network))/, text),
    tenureMonths: (() => {
      const m = /Tenure[^\d\n]{0,16}?(\d{1,3})(?!\d)/i.exec(text);
      const n = m ? Number(m[1]) : scheme ? Number(scheme[1]) : NaN;
      return Number.isFinite(n) && n > 0 && n <= 120 ? n : null;
    })(),
    grossLoanAmount: row(/Gross\s*Loan\s*Amount/, text),
    netLoanAmount,
    netDisbursement: row(/Net\s*Disbursement/, text),
    totalDeductions: row(/Total\s*Deductions/, text),
    advanceEmi: row(/Advance\s*EM[Il1]/, text),
    advanceEmis: scheme ? Number(scheme[2]) : null,
    dealerSubsidy: labelled(/Dealer\s*Interest\s*Subsidy(?:\s*value)?\s*\(%\)/, text),
    dealerSubsidyPercent: subsidy ? Number(subsidy[1]) : null,
    bajajCharges: sum(
      row(/Upfront\s*Interest/, text),
      row(/Service\s*Charge/, text),
      labelled(/Card\s*Charges\s*\(EMI, Add on Card\)/, text),
      row(/Mandate\s*Registration\s*Charges/, text),
      row(/Convenience\s*Fee\s*Charges/, text)
    ),
    totalGst: row(/Total\s*GST/, text),
    mobile: match(/Mobile\s*(?:Number|No\.?)?\s*:?\s*(?:\+?91[\s-]?)?([6-9](?:[\s-]?\d){9})(?!\d)/i, text)?.replace(/\D/g, "") ?? null,
  };
}

async function readPdfText(buffer: Buffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

export async function parseDeliveryOrder(buffer: Buffer): Promise<ParsedDeliveryOrder> {
  return parseDeliveryOrderText(await readPdfText(buffer));
}

/**
 * Reads an uploaded PDF once and works out whether it's a Bajaj delivery order
 * or a customer's GST certificate, so both can be dropped on the same upload
 * box. A DO is identified by its own markers first, since a DO could in theory
 * mention a GSTIN and we don't want that misread as a certificate.
 */
export async function parseUploadedDocument(buffer: Buffer): Promise<ParsedDocument> {
  return parseUploadedText(await readPdfText(buffer));
}

/** Same as parseUploadedDocument, for text already read (e.g. OCR of a photo in the browser). */
export function parseUploadedText(text: string): ParsedDocument {
  const isDeliveryOrder = /DELIVERY ORDER|DO ID:|Bajaj Finance/i.test(text);
  if (!isDeliveryOrder && looksLikeGstCertificate(text)) {
    return { docType: "GST", ...parseGstCertificateText(text) };
  }
  return { docType: "DO", ...parseDeliveryOrderText(text) };
}
