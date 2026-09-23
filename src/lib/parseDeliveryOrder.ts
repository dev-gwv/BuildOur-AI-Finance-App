import { extractText } from "unpdf";
import { looksLikeGstCertificate, parseGstCertificateText, type ParsedGstCertificate } from "./parseGstCertificate";

export interface ParsedDeliveryOrder {
  doId: string | null;
  doDate: string | null; // ISO yyyy-mm-dd
  customerName: string | null;
  deliveryAddress: string | null;
  productPrice: number | null;
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
  const priceMatch = /Product\s*Price\s*:?\s*(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/.exec(text);

  return {
    doId: match(/DO\s*ID\s*:?\s*([A-Z0-9]{6,})/, text),
    doDate: toIsoDate(match(/Date\s*:?\s*(\d{2}\/\d{2}\/\d{4})/, text)),
    customerName: match(/loan application of Mr\/Miss\/Mrs\.\s*([A-Za-z.\s]+?)\s+has been approved/, text),
    deliveryAddress: match(/Address of the customer for delivery:\s*(.+?)\s*Mobile Number:/, text),
    productPrice: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
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
