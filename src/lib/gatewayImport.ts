// Pure: a gateway's exported payments report (CSV or Excel rows) -> payments
// the app can pick from. Kept free of the database and file handling so it can
// be tested on its own.

export type ImportProvider = "razorpay" | "tagmango";

export const IMPORT_FIELDS = [
  "externalId",
  "amount",
  "date",
  "status",
  "fee",
  "feeGst",
  "net",
  "gst",
  "refunded",
  "method",
  "name",
  "email",
  "contact",
  "vpa",
  "description",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, number | null>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  externalId: "Payment / transaction ID",
  amount: "Amount paid",
  date: "Date",
  status: "Status",
  fee: "Gateway fee / commission",
  feeGst: "GST on the fee",
  net: "Net / settled amount",
  gst: "GST in the amount",
  refunded: "Amount refunded",
  method: "Payment method",
  name: "Customer name",
  email: "Email",
  contact: "Phone",
  vpa: "UPI ID",
  description: "Description / product",
};

/** Without these a row can't become a payment. */
export const REQUIRED_FIELDS: ImportField[] = ["amount", "date"];

/** Column names each report uses for each field, lower-case, words only. */
const COMMON: Partial<Record<ImportField, string[]>> = {
  externalId: ["id", "payment id", "transaction id", "txn id", "order id", "reference", "reference id", "transaction reference"],
  amount: ["amount", "amount paid", "paid amount", "charged amount", "payment amount", "total amount", "total", "price", "gross amount", "amount inr"],
  date: ["created at", "date", "payment date", "transaction date", "paid on", "paid at", "completed at", "occurred at", "purchase date", "order date", "date time", "timestamp"],
  status: ["status", "payment status", "order status", "transaction status"],
  fee: ["fee", "fees", "gateway fee", "commission", "platform fee", "service fee", "processing fee"],
  net: ["net amount", "net", "settlement amount", "settled amount", "amount settled", "payout amount", "earnings", "net earnings", "creator earnings"],
  refunded: ["amount refunded", "refund amount", "refunded amount", "refunded"],
  method: ["method", "payment method", "payment mode", "mode", "payment type", "type", "payment cycle"],
  name: ["name", "customer name", "user name", "buyer name", "full name", "customer", "subscriber name", "student name"],
  email: ["email", "customer email", "email id", "email address", "user email"],
  contact: ["contact", "phone", "mobile", "phone number", "mobile number", "customer phone", "contact number", "whatsapp number"],
  vpa: ["vpa", "upi id", "upi"],
  description: ["description", "notes", "product", "product name", "item"],
};
const PER_PROVIDER: Record<ImportProvider, Partial<Record<ImportField, string[]>>> = {
  razorpay: {
    // Razorpay's "fee" includes its GST, which "tax" is.
    feeGst: ["tax", "fee tax", "gst on fee"],
    externalId: ["payment id", "id", "razorpay payment id"],
  },
  tagmango: {
    externalId: ["transaction id", "order id", "id"],
    fee: ["tagmango fee", "tagmango commission", "commission", "platform fee", "commission amount", "commission including gst"],
    feeGst: ["gst on commission", "commission gst", "gst on platform fee", "tax on commission"],
    gst: ["gst", "gst amount", "tax", "tax amount"],
    description: ["mango", "mango name", "mango title", "course", "course name", "product", "product name", "title", "offering"],
  },
};

/** "Amount (INR)" -> "amount inr"; "created_at" -> "created at". */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasesFor(provider: ImportProvider, field: ImportField): string[] {
  return [...(PER_PROVIDER[provider][field] ?? []), ...(COMMON[field] ?? [])];
}

/** The best column for each field: an exact name first, then a name that starts with one. */
export function autoMap(headers: unknown[], provider: ImportProvider): ColumnMapping {
  const names = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {};
  // Most specific fields first, so "amount refunded" isn't taken as the amount.
  const order: ImportField[] = ["externalId", "refunded", "feeGst", "fee", "net", "gst", "date", "amount", "status", "method", "email", "contact", "vpa", "name", "description"];
  for (const field of order) {
    const aliases = aliasesFor(provider, field);
    let found = -1;
    for (const alias of aliases) {
      found = names.findIndex((n, i) => !taken.has(i) && n === alias);
      if (found >= 0) break;
    }
    if (found < 0) {
      for (const alias of aliases) {
        if (alias.length < 4) continue;
        found = names.findIndex((n, i) => !taken.has(i) && (n.startsWith(`${alias} `) || n.endsWith(` ${alias}`)));
        if (found >= 0) break;
      }
    }
    mapping[field] = found >= 0 ? found : null;
    if (found >= 0) taken.add(found);
  }
  return mapping;
}

/** The header row: the first of the opening rows naming an amount and a date column. */
export function findHeaderRow(rows: unknown[][], provider: ImportProvider): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const m = autoMap(rows[i], provider);
    if (m.amount != null && m.date != null) return i;
  }
  return 0;
}

// --- Reading files ----------------------------------------------------------

/** RFC 4180 CSV (quotes, doubled quotes, newlines in quotes); comma, semicolon or tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// --- Values -----------------------------------------------------------------

/** "₹1,23,456.50", "Rs. 500", "INR 5000", 5000 -> rupees; "", "-", "N/A" -> null. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s || /^(-|—|n\/?a|null|none)$/i.test(s)) return null;
  // "Rs." and "INR" first: the full stop after Rs isn't a decimal point.
  const bare = s.replace(/^\(|\)$/g, "").replace(/^\s*(?:₹|rs\.?|inr)\s*/i, "");
  const negative = /^\(.*\)$/.test(s) || /^-/.test(bare.trim());
  const digits = bare.replace(/[^\d.]/g, "");
  if (!digits || !/\d/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const IST_MS = 330 * 60_000;

/** An Indian wall-clock time as the instant it was. */
function ist(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - IST_MS);
}

function timeOf(rest: string): [number, number, number] {
  const t = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm)?/i.exec(rest);
  if (!t) return [0, 0, 0];
  let h = Number(t[1]);
  if (t[4]) h = (h % 12) + (/pm/i.test(t[4]) ? 12 : 0);
  return [h, Number(t[2]), Number(t[3] ?? 0)];
}

/**
 * The moment a payment was made. Reports print it as "24/08/2026 11:02:41",
 * "2026-08-24 11:02", "24 Aug 2026, 11:02 AM", an ISO time or epoch seconds;
 * a time without a zone is India's. Spreadsheet date cells arrive as Dates
 * holding the wall-clock time as if it were UTC.
 */
export function parseWhen(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() - IST_MS);
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(Number(s));
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/.exec(s);
  if (m) return ist(+m[1], +m[2], +m[3], ...timeOf(m[4]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/.exec(s);
  if (m) return ist(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], ...timeOf(m[4]));
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})(.*)$/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ist(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1], ...timeOf(m[4]));
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})(.*)$/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ist(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2], ...timeOf(m[4]));
  return null;
}

/** Received money: "captured"; returned: "refunded"; anything that never paid: null. */
export function paymentStatus(v: unknown): "captured" | "refunded" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "captured";
  if (/refund/.test(s)) return "refunded";
  if (/^(captured|success|successful|succeeded|completed|complete|paid|settled|processed|done|active)$/.test(s)) return "captured";
  return null;
}

const text = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s && !/^(-|—|n\/?a|null|none)$/i.test(s) ? s : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type ImportedPayment = {
  externalId: string;
  status: "captured" | "refunded";
  amount: number;
  feeAmount: number;
  feeGstAmount: number;
  gstAmount: number | null;
  method: string | null;
  /** ISO instant. */
  paidAt: string;
  name: string | null;
  email: string | null;
  contact: string | null;
  vpa: string | null;
  description: string | null;
};

export type ImportResult = {
  payments: ImportedPayment[];
  /** Why rows were left out, and how many. */
  skipped: Record<string, number>;
  /** The fee's GST wasn't in the report, so it was taken as 18% inside the fee. */
  feeGstAssumed: boolean;
};

/**
 * Rows (after the header) -> payments. The gateway fee is taken as including
 * its GST (Razorpay's "fee" does; so does TagMango's commission); without a
 * fee column it's what the gross and net differ by. Amounts in paise are
 * divided down. Without an id column, one is made from the date, amount and
 * customer, so re-importing the same report still finds the same rows.
 */
export function rowsToPayments(
  rows: unknown[][],
  mapping: ColumnMapping,
  provider: ImportProvider,
  opts: { inPaise?: boolean } = {}
): ImportResult {
  const col = (row: unknown[], f: ImportField) => (mapping[f] != null ? row[mapping[f]!] : undefined);
  const scale = opts.inPaise ? 100 : 1;
  const money = (v: unknown) => {
    const n = parseMoney(v);
    return n == null ? null : n / scale;
  };
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const byId = new Map<string, ImportedPayment>();
  let feeGstAssumed = false;

  for (const row of rows) {
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const status = paymentStatus(col(row, "status"));
    if (!status) {
      skip("not completed (failed, pending or abandoned)");
      continue;
    }
    const amount = money(col(row, "amount"));
    if (amount == null || amount <= 0) {
      skip("no amount");
      continue;
    }
    const when = parseWhen(col(row, "date"));
    if (!when) {
      skip("date not readable");
      continue;
    }

    let fee = money(col(row, "fee"));
    const net = money(col(row, "net"));
    if (fee == null && net != null && net > 0 && net <= amount) fee = amount - net;
    fee = Math.max(0, fee ?? 0);
    let feeGst = money(col(row, "feeGst"));
    if (feeGst == null && fee > 0) {
      feeGst = fee * (18 / 118);
      feeGstAssumed = true;
    }
    feeGst = Math.min(Math.max(0, feeGst ?? 0), fee);

    const email = text(col(row, "email"));
    const contact = text(col(row, "contact"))?.replace(/\.0+$/, "") ?? null;
    const name = text(col(row, "name"));
    const externalId =
      text(col(row, "externalId")) ?? `${provider}:${when.toISOString().slice(0, 16)}:${r2(amount)}:${(email ?? contact ?? name ?? "").toLowerCase()}`;
    const gst = money(col(row, "gst"));
    byId.set(externalId, {
      externalId,
      status,
      amount: r2(amount),
      feeAmount: r2(fee - feeGst),
      feeGstAmount: r2(feeGst),
      gstAmount: gst == null ? null : r2(gst),
      method: text(col(row, "method"))?.toLowerCase() ?? null,
      paidAt: when.toISOString(),
      name,
      email,
      contact,
      vpa: text(col(row, "vpa")),
      description: text(col(row, "description")),
    });
  }
  return { payments: [...byId.values()], skipped, feeGstAssumed };
}

/** Whether a header says its figures are in paise ("Amount (paise)"). */
export function headersInPaise(headers: unknown[], mapping: ColumnMapping): boolean {
  const i = mapping.amount;
  return i != null && /paise|paisa/i.test(String(headers[i] ?? ""));
}
