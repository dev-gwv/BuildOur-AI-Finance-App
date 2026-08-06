import { MULBERRY_LOGO_DATA_URI } from "./mulberryLogo";

export type BrandKey = "GRATEFUL" | "MULBERRY";

export interface Brand {
  key: BrandKey;
  /** Legal name printed on the invoice. */
  name: string;
  addressLines: string[];
  /** GST-registered sellers show a tax breakup; unregistered ones must not. */
  gstRegistered: boolean;
  gstin?: string;
  companyId?: string;
  placeOfSupply?: string;
  /** Heading on the document — an unregistered seller cannot title it "Tax Invoice". */
  documentTitle: string;
  invoicePrefix: string;
  /** Continues the existing numbering series for each business. */
  nextNumberFrom: number;
  logoDataUri?: string;
  bank?: {
    accountName: string;
    accountNumber: string;
    ifsc: string;
    accountType: string;
    bankName: string;
  };
  /** Tailwind classes for the document header, so each brand keeps its own identity. */
  headerClass: string;
  accentTextClass: string;
}

export const BRANDS: Record<BrandKey, Brand> = {
  GRATEFUL: {
    key: "GRATEFUL",
    name: "Grateful World Ventures (OPC) Private Limited",
    addressLines: ["Delhi", "India"],
    gstRegistered: true,
    gstin: "07AAJCG9243K1Z5",
    companyId: "U80301DL2022OPC401949",
    placeOfSupply: "Delhi (07)",
    documentTitle: "Tax Invoice",
    invoicePrefix: "INV-",
    nextNumberFrom: 2242,
    bank: {
      accountName: "Grateful World Ventures (OPC) Private Limited",
      accountNumber: "66-360-5600-830",
      ifsc: "ICIC0006636",
      accountType: "Current Account",
      bankName: "ICICI Bank",
    },
    headerClass: "bg-gradient-to-r from-indigo-600 to-indigo-700 print:bg-indigo-700",
    accentTextClass: "text-indigo-200",
  },
  MULBERRY: {
    key: "MULBERRY",
    name: "The Mulberry Weddings",
    addressLines: ["1st Floor, A 120, Shakarpur, Vikas Marg, Laxmi Nagar", "Delhi 110092", "India"],
    // Not GST-registered, so no tax is charged and no GSTIN is shown.
    gstRegistered: false,
    documentTitle: "Invoice",
    invoicePrefix: "INV-",
    nextNumberFrom: 1121,
    logoDataUri: MULBERRY_LOGO_DATA_URI,
    headerClass: "bg-gradient-to-r from-[#5b0d1c] to-[#7b1226] print:bg-[#5b0d1c]",
    accentTextClass: "text-amber-200",
  },
};

export function formatInvoiceNumber(brand: Brand, seq: number): string {
  return `${brand.invoicePrefix}${String(seq).padStart(6, "0")}`;
}

/** Next number in a brand's own series, continuing from the last one issued. */
export function nextInvoiceNumber(brand: Brand, lastNumber: string | null): string {
  const lastSeq = lastNumber ? parseInt(lastNumber.replace(/\D/g, ""), 10) : NaN;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : brand.nextNumberFrom;
  return formatInvoiceNumber(brand, next);
}
