import { extractText } from "unpdf";

export interface ParsedDeliveryOrder {
  doId: string | null;
  doDate: string | null; // ISO yyyy-mm-dd
  customerName: string | null;
  deliveryAddress: string | null;
  productPrice: number | null;
}

function match(re: RegExp, text: string): string | null {
  return re.exec(text)?.[1]?.trim() ?? null;
}

function toIsoDate(ddmmyyyy: string | null): string | null {
  const m = ddmmyyyy && /(\d{2})\/(\d{2})\/(\d{4})/.exec(ddmmyyyy);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Extracts the fields we need from Bajaj Finance's standard Delivery Order
// template. It's a fixed layout across deals, so plain regex on the flattened
// text is enough — no generic PDF-layout parsing required.
export async function parseDeliveryOrder(buffer: Buffer): Promise<ParsedDeliveryOrder> {
  const { text: merged } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const text = merged.replace(/\s+/g, " ");

  // Decimals are optional: the amount varies per deal and isn't always written
  // as "1,17,999.00" — some DOs state a round figure like "1,77,000".
  const priceMatch = /Product Price\s*([\d,]+(?:\.\d{1,2})?)/.exec(text);

  return {
    doId: match(/DO ID:\s*([A-Z0-9]+)/, text),
    doDate: toIsoDate(match(/Date:\s*(\d{2}\/\d{2}\/\d{4})/, text)),
    customerName: match(/loan application of Mr\/Miss\/Mrs\.\s*([A-Za-z.\s]+?)\s+has been approved/, text),
    deliveryAddress: match(/Address of the customer for delivery:\s*(.+?)\s*Mobile Number:/, text),
    productPrice: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
  };
}
