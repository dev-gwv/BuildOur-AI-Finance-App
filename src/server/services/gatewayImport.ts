import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  autoMap,
  findHeaderRow,
  headersInPaise,
  parseCsv,
  rowsToPayments,
  type ColumnMapping,
  type ImportProvider,
} from "@/lib/gatewayImport";
import { importStats } from "@/lib/integrations/storedPayments";
import { audit } from "../audit";
import { badRequest } from "../errors";
import type { SessionUser } from "../session";
import { guardWrite, round2, rupees } from "./common";

/**
 * Gateways connected by uploading their exported payments report instead of
 * an API key. An upload is read twice: once for a preview (what was found,
 * how the columns were matched, a few sample rows) and once more, with any
 * column matching the admin corrected, to save. Payments are kept by the
 * gateway's own id, so uploading overlapping reports never duplicates one.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 50_000;
const GATEWAY_NAME: Record<ImportProvider, string> = { razorpay: "Razorpay", tagmango: "TagMango" };

export const importOptionsSchema = z.object({
  /** JSON {field: column index}, when the admin corrected the automatic matching. */
  mapping: z.string().max(4000).optional(),
  inPaise: z.enum(["on", "off"]).optional(),
  commit: z.literal("on").optional(),
});

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return "";
  }
  return v;
}

/** The report as rows of cells: CSV, or an Excel workbook's fullest sheet. */
async function readTable(file: File): Promise<unknown[][]> {
  if (file.size === 0) throw badRequest("That file is empty");
  if (file.size > MAX_BYTES) throw badRequest("That file is over 8 MB — export a shorter period");
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") return parseCsv(buffer.toString("utf8"));
  if (name.endsWith(".xls") && !name.endsWith(".xlsx")) {
    throw badRequest("Old .xls files can't be read — download the report as CSV or .xlsx instead");
  }
  if (!name.endsWith(".xlsx")) throw badRequest("Upload the report as a CSV or Excel (.xlsx) file");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("That Excel file couldn't be read — try downloading the report as CSV");
  }
  const sheet = [...workbook.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!sheet) throw badRequest("That workbook has no sheets");
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    // ExcelJS rows are 1-based: index 0 is always empty.
    rows.push(values.slice(1).map(cellValue));
  });
  return rows;
}

function parseMapping(json: string | undefined, columns: number): ColumnMapping | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw badRequest("The column matching couldn't be read");
  }
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const v = (raw as Record<string, unknown>)?.[field];
    mapping[field] = typeof v === "number" && Number.isInteger(v) && v >= 0 && v < columns ? v : null;
  }
  return mapping;
}

export async function importGatewayReport(
  admin: SessionUser,
  provider: ImportProvider,
  file: File,
  options: z.infer<typeof importOptionsSchema>,
  req: Request
) {
  await guardWrite(admin);
  const table = await readTable(file);
  if (table.length > MAX_ROWS) throw badRequest(`That report has over ${MAX_ROWS.toLocaleString("en-IN")} rows — export a shorter period`);
  const headerRow = findHeaderRow(table, provider);
  const headers = (table[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const mapping = parseMapping(options.mapping, headers.length) ?? autoMap(headers, provider);
  const inPaise = options.inPaise ? options.inPaise === "on" : headersInPaise(headers, mapping);
  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] == null);
  const { payments, skipped, feeGstAssumed } = missing.length
    ? { payments: [], skipped: {}, feeGstAssumed: false }
    : rowsToPayments(table.slice(headerRow + 1), mapping, provider, { inPaise });

  const known = payments.length
    ? await prisma.gatewayTransaction.count({ where: { provider, externalId: { in: payments.map((p) => p.externalId) } } })
    : 0;
  const times = payments.map((p) => p.paidAt).sort();
  const summary = {
    fileName: file.name,
    headers,
    mapping,
    inPaise,
    missing,
    count: payments.length,
    alreadyImported: known,
    total: round2(payments.reduce((s, p) => s + p.amount, 0)),
    fees: round2(payments.reduce((s, p) => s + p.feeAmount + p.feeGstAmount, 0)),
    from: times[0] ?? null,
    to: times[times.length - 1] ?? null,
    skipped,
    feeGstAssumed,
    sample: [...payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 8),
    imported: 0,
  };
  if (!options.commit) return summary;
  if (missing.length) throw badRequest("Match the amount and date columns before importing");
  if (payments.length === 0) throw badRequest("No completed payments were found in that report");

  for (let i = 0; i < payments.length; i += 200) {
    await prisma.$transaction(
      payments.slice(i, i + 200).map((p) => {
        const data = { ...p, paidAt: new Date(p.paidAt), importedById: admin.id, importedAt: new Date() };
        return prisma.gatewayTransaction.upsert({
          where: { provider_externalId: { provider, externalId: p.externalId } },
          create: { provider, ...data },
          update: data,
        });
      })
    );
  }
  // Uploading a report is choosing this way of connecting.
  await prisma.integration.upsert({
    where: { provider },
    create: { provider, enabled: true, mode: "file" },
    update: { enabled: true, mode: "file", lastError: null },
  });
  await audit({
    user: admin,
    action: `integration.${provider}`,
    entityType: "integration",
    entityId: provider,
    summary: `Imported ${GATEWAY_NAME[provider]} report "${file.name}": ${payments.length} payments (${payments.length - known} new), ${rupees(summary.total)}`,
    req,
  });
  return { ...summary, imported: payments.length };
}

/** Switch how a gateway is connected. "api" needs keys saved to be on. */
export async function setIntegrationMode(admin: SessionUser, provider: ImportProvider, mode: "api" | "file", req: Request) {
  await guardWrite(admin);
  const existing = await prisma.integration.findUnique({ where: { provider } });
  const hasKeys = Boolean(existing?.keyId && existing.secretEnc);
  await prisma.integration.upsert({
    where: { provider },
    create: { provider, mode, enabled: mode === "file" ? (await importStats(provider)).count > 0 : false },
    update: { mode, enabled: mode === "file" ? (await importStats(provider)).count > 0 : hasKeys },
  });
  await audit({
    user: admin,
    action: `integration.${provider}`,
    entityType: "integration",
    entityId: provider,
    summary: `${GATEWAY_NAME[provider]} now connected by ${mode === "file" ? "uploaded reports" : "API key"}`,
    req,
  });
}
