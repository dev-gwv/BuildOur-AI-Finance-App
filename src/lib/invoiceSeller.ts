// Grateful World Ventures is the sole entity that issues these invoices —
// fixed legal/bank details, not per-invoice or per-company data.
export const INVOICE_SELLER = {
  name: "Grateful World Ventures (OPC) Private Limited",
  companyId: "U80301DL2022OPC401949",
  gstin: "07AAJCG9243K1Z5",
  addressLines: ["Delhi", "India"],
  placeOfSupply: "Delhi (07)",
  bank: {
    accountName: "Grateful World Ventures (OPC) Private Limited",
    accountNumber: "66-360-5600-830",
    ifsc: "ICIC0006636",
    accountType: "Current Account",
    bankName: "ICICI Bank",
  },
} as const;

// Continues after INV-002241, the last invoice raised before this was automated.
export const INVOICE_NUMBER_START = 2242;

export function formatInvoiceNumber(seq: number): string {
  return `INV-${String(seq).padStart(6, "0")}`;
}
