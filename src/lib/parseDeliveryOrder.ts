import { PDFParse } from "pdf-parse";

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
  const parser = new PDFParse({ data: buffer });
  let text: string;
  try {
    const result = await parser.getText();
    text = result.text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }

  const priceMatch = /Product Price\s*([\d,]+\.\d{2})/.exec(text);

  return {
    doId: match(/DO ID:\s*([A-Z0-9]+)/, text),
    doDate: toIsoDate(match(/Date:\s*(\d{2}\/\d{2}\/\d{4})/, text)),
    customerName: match(/loan application of Mr\/Miss\/Mrs\.\s*([A-Za-z.\s]+?)\s+has been approved/, text),
    deliveryAddress: match(/Address of the customer for delivery:\s*(.+?)\s*Mobile Number:/, text),
    productPrice: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
  };
}
