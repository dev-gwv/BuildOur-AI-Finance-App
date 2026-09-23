/**
 * IPC and IWC are two ventures run under the one GRATEFUL brand: the invoice
 * header, GSTIN and bank are Grateful's (see src/lib/brands.ts), but each keeps
 * its own invoice series and its own Google Sheet. They are deliberately not
 * brands — adding a brand would mean a new seller on the invoice.
 */
export type VentureKey = "IPC" | "IWC";

/**
 * Every workbook the app mirrors into: the two ventures plus Mulberry's
 * (which is a brand, not a venture). Expenses are tagged with one of these.
 */
export type LedgerKey = VentureKey | "MULBERRY";

export interface Venture {
  key: VentureKey;
  label: string;
  /** Route segment for the venture's tab, e.g. /ipc. */
  path: string;
  /**
   * Kept distinct from Grateful's legacy "INV-" so the series can't collide
   * on Invoice.invoiceNumber, which is unique across every brand.
   */
  prefix: string;
  /** First number issued in the venture's own series. */
  nextNumberFrom: number;
}

export const VENTURES: Record<VentureKey, Venture> = {
  IPC: { key: "IPC", label: "IPC Finance", path: "/ipc", prefix: "IPC-INV-", nextNumberFrom: 2242 },
  IWC: { key: "IWC", label: "IWC Finance", path: "/iwc", prefix: "IWC-INV-", nextNumberFrom: 1001 },
};

export const VENTURE_KEYS = Object.keys(VENTURES) as VentureKey[];

export const LEDGERS: Record<LedgerKey, { key: LedgerKey; label: string; sheetEnvUrl: string; sheetEnvSecret: string }> = {
  IPC: { key: "IPC", label: "IPC Finance", sheetEnvUrl: "SHEETS_WEBHOOK_URL_IPC", sheetEnvSecret: "SHEETS_WEBHOOK_SECRET_IPC" },
  IWC: { key: "IWC", label: "IWC Finance", sheetEnvUrl: "SHEETS_WEBHOOK_URL_IWC", sheetEnvSecret: "SHEETS_WEBHOOK_SECRET_IWC" },
  // Mulberry was wired up first, so it keeps the original variable names.
  MULBERRY: { key: "MULBERRY", label: "Mulberry Weddings", sheetEnvUrl: "SHEETS_WEBHOOK_URL", sheetEnvSecret: "SHEETS_WEBHOOK_SECRET" },
};

export const LEDGER_KEYS = Object.keys(LEDGERS) as LedgerKey[];

export function parseVenture(value: unknown): VentureKey | null {
  return typeof value === "string" && value in VENTURES ? (value as VentureKey) : null;
}

export function parseLedger(value: unknown): LedgerKey | null {
  return typeof value === "string" && value in LEDGERS ? (value as LedgerKey) : null;
}

export function formatVentureInvoiceNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/** Next number in a venture's own series, continuing from the last one issued. */
export function nextVentureInvoiceNumber(venture: Venture, lastNumber: string | null): string {
  const lastSeq =
    lastNumber && isVentureInvoiceNumber(lastNumber, venture)
      ? parseInt(lastNumber.slice(venture.prefix.length).replace(/\D/g, ""), 10)
      : NaN;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : venture.nextNumberFrom;
  return formatVentureInvoiceNumber(venture.prefix, next);
}

export function isVentureInvoiceNumber(value: string, venture: Venture): boolean {
  return value.trim().toUpperCase().startsWith(venture.prefix);
}

/** Which workbook an invoice's money belongs in, or null if none. */
export function ledgerForInvoice(invoice: { brand: string; venture: string | null }): LedgerKey | null {
  if (invoice.brand === "MULBERRY") return "MULBERRY";
  return parseVenture(invoice.venture);
}

/** Where an invoice is opened in the app, by the section it belongs to. */
export function invoiceHref(invoice: { id: string; brand: string; venture: string | null }): string {
  const ledger = ledgerForInvoice(invoice);
  if (ledger === "MULBERRY") return `/mulberry/${invoice.id}`;
  if (ledger) return `${VENTURES[ledger].path}/${invoice.id}`;
  return `/invoices/${invoice.id}`;
}
