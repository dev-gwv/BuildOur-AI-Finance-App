import { extractText } from "unpdf";
import { looksLikeGstCertificate, parseGstCertificateText, type ParsedGstCertificate } from "./parseGstCertificate";

export interface ParsedDeliveryOrder {
  doId: string | null;
  doDate: string | null; // ISO yyyy-mm-dd
  customerName: string | null;
  deliveryAddress: string | null;
  productPrice: number | null;
  /**
   * The rest of the DO's amount table, when present. Bajaj DOs letter their
   * rows (A Product Price, B Down Payment, C Loan Amount, ...). Only the
   * product price has been seen on a real DO so far — these patterns are
   * written to the usual Bajaj labels and are null whenever they don't match.
   */
  downPayment: number | null;
  loanAmount: number | null;
  emi: number | null;
  tenureMonths: number | null;
  mobile: string | null;
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

  return {
    doId: match(/DO\s*ID\s*:?\s*([A-Z0-9]{6,})/, text),
    doDate: toIsoDate(match(/Date\s*:?\s*(\d{2}\/\d{2}\/\d{4})/, text)),
    customerName: match(/loan application of Mr\/Miss\/Mrs\.\s*([A-Za-z.\s]+?)\s+has been approved/, text),
    deliveryAddress: match(/Address of the customer for delivery:\s*(.+?)\s*Mobile Number:/, text),
    productPrice: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
    downPayment: amountAfter(/Down\s*Payment|Advance\s*EMI|Margin\s*Money/, text),
    loanAmount: amountAfter(/Loan\s*Amount|Finance\s*Amount|Amount\s*Financed|Financed\s*Amount/, text),
    // OCR reads the capital I in "EMI" as l or 1.
    emi: amountAfter(/EM[Il1]\s*Amount|Monthly\s*EM[Il1]|EM[Il1](?!\s*(?:Start|Date|Card|Network))/, text),
    tenureMonths: (() => {
      const m = /Tenure[^\d\n]{0,16}?(\d{1,3})(?!\d)/i.exec(text);
      const n = m ? Number(m[1]) : NaN;
      return Number.isFinite(n) && n > 0 && n <= 120 ? n : null;
    })(),
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
