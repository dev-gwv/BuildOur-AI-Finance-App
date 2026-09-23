import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { getScope } from "@/server/scope";
import { monthLabel, parseGstPeriod, type GstLine } from "@/lib/gstReport";
import { loadGstReport, resolveGstBusinessIds } from "@/lib/gstReportData";

const MONEY = "#,##0.00";
// Stored dates and the period's range are calendar days at midnight UTC, so ISO gives the right day.
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The GST report as a workbook for the CA: summary, B2B, B2C, credit notes, HSN summary, input GST. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const period = parseGstPeriod(searchParams.get("period") ?? undefined);
  // Only Grateful-entity businesses the user can access; a crafted id is ignored.
  const scope = await getScope(user);
  const businessIds = resolveGstBusinessIds(scope, searchParams.get("businessId"));
  const report = await loadGstReport({ businessIds, period });

  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Period", key: "period", width: 16 },
    { header: "Type", key: "type", width: 8 },
    { header: "Invoices", key: "count", width: 10 },
    { header: "Taxable value", key: "taxable", width: 16, style: { numFmt: MONEY } },
    { header: "CGST", key: "cgst", width: 14, style: { numFmt: MONEY } },
    { header: "SGST", key: "sgst", width: 14, style: { numFmt: MONEY } },
    { header: "IGST", key: "igst", width: 14, style: { numFmt: MONEY } },
    { header: "Total tax", key: "tax", width: 14, style: { numFmt: MONEY } },
    { header: "Invoice value", key: "value", width: 16, style: { numFmt: MONEY } },
  ];
  summary.getRow(1).font = { bold: true };
  const negative = (t: typeof report.output) => ({
    ...t,
    taxable: -t.taxable,
    cgst: -t.cgst,
    sgst: -t.sgst,
    igst: -t.igst,
    tax: -t.tax,
    value: -t.value,
  });
  for (const m of report.months) {
    if (m.b2b.count) summary.addRow({ period: monthLabel(m.month), type: "B2B", ...m.b2b });
    if (m.b2c.count) summary.addRow({ period: monthLabel(m.month), type: "B2C", ...m.b2c });
    if (m.credits.count) summary.addRow({ period: monthLabel(m.month), type: "CN", ...negative(m.credits) });
  }
  summary.addRow({});
  summary.addRow({ period: "TOTAL INVOICES", ...report.output }).font = { bold: true };
  if (report.credits.length) {
    summary.addRow({ period: "Less credit notes (CDNR)", type: "B2B", ...negative(report.cdnr) });
    summary.addRow({ period: "Less credit notes (CDNUR)", type: "B2C", ...negative(report.cdnur) });
    summary.addRow({ period: "NET OUTPUT", ...report.netOutput }).font = { bold: true };
  }
  summary.addRow({});
  summary.addRow({ period: "Input GST on costs", tax: report.input.costs });
  summary.addRow({ period: "Input GST on gateway fees", tax: report.input.gatewayFees });
  summary.addRow({ period: "Net payable (estimate)", tax: report.netPayable }).font = { bold: true };
  summary.addRow({});
  summary.addRow({
    period: "An estimate for the CA — not a return. Input credit covers only what is recorded in the app.",
  });

  const invoiceColumns: Partial<ExcelJS.Column>[] = [
    { header: "Invoice no.", key: "invoiceNumber", width: 18 },
    { header: "Date", key: "date", width: 12 },
    { header: "Customer", key: "customerName", width: 28 },
    { header: "GSTIN", key: "customerGstin", width: 18 },
    { header: "Place of supply", key: "placeOfSupply", width: 20 },
    { header: "Business", key: "business", width: 20 },
    { header: "Taxable value", key: "taxable", width: 14, style: { numFmt: MONEY } },
    { header: "Rate %", key: "rates", width: 10 },
    { header: "CGST", key: "cgst", width: 12, style: { numFmt: MONEY } },
    { header: "SGST", key: "sgst", width: 12, style: { numFmt: MONEY } },
    { header: "IGST", key: "igst", width: 12, style: { numFmt: MONEY } },
    { header: "Invoice value", key: "value", width: 14, style: { numFmt: MONEY } },
  ];
  const addInvoices = (name: string, lines: GstLine[]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = invoiceColumns;
    sheet.getRow(1).font = { bold: true };
    for (const l of lines) {
      sheet.addRow({
        ...l,
        date: day(l.invoiceDate),
        customerGstin: l.customerGstin ?? "",
        rates: [...new Set(l.hsn.map((h) => h.gstPercent))].join(" / ") || String(l.gstPercent),
      });
    }
  };
  addInvoices("B2B", report.lines.filter((l) => l.b2b));
  addInvoices("B2C", report.lines.filter((l) => !l.b2b));

  const credits = workbook.addWorksheet("Credit notes");
  credits.columns = [
    { header: "Credit note no.", key: "number", width: 18 },
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 8 },
    { header: "Original invoice", key: "invoiceNumber", width: 18 },
    { header: "Invoice date", key: "invoiceDate", width: 12 },
    { header: "Customer", key: "customerName", width: 28 },
    { header: "GSTIN", key: "customerGstin", width: 18 },
    { header: "Place of supply", key: "placeOfSupply", width: 20 },
    { header: "Reason", key: "reason", width: 26 },
    { header: "Taxable value", key: "taxable", width: 14, style: { numFmt: MONEY } },
    { header: "Rate %", key: "gstPercent", width: 8 },
    { header: "CGST", key: "cgst", width: 12, style: { numFmt: MONEY } },
    { header: "SGST", key: "sgst", width: 12, style: { numFmt: MONEY } },
    { header: "IGST", key: "igst", width: 12, style: { numFmt: MONEY } },
    { header: "Note value", key: "value", width: 14, style: { numFmt: MONEY } },
  ];
  credits.getRow(1).font = { bold: true };
  for (const c of report.credits) {
    credits.addRow({
      ...c,
      date: day(c.noteDate),
      type: c.b2b ? "CDNR" : "CDNUR",
      invoiceDate: day(c.invoiceDate),
      customerGstin: c.customerGstin ?? "",
    });
  }

  const hsn = workbook.addWorksheet("HSN summary");
  hsn.columns = [
    { header: "HSN / SAC", key: "hsnSac", width: 14 },
    { header: "Rate %", key: "gstPercent", width: 8 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Taxable value", key: "taxable", width: 16, style: { numFmt: MONEY } },
    { header: "CGST", key: "cgst", width: 12, style: { numFmt: MONEY } },
    { header: "SGST", key: "sgst", width: 12, style: { numFmt: MONEY } },
    { header: "IGST", key: "igst", width: 12, style: { numFmt: MONEY } },
    { header: "Total value", key: "total", width: 16, style: { numFmt: MONEY } },
  ];
  hsn.getRow(1).font = { bold: true };
  for (const h of report.hsn) hsn.addRow(h);

  if (report.cancelled.length) {
    const cancelled = workbook.addWorksheet("Cancelled");
    cancelled.columns = [
      { header: "Invoice no.", key: "invoiceNumber", width: 18 },
      { header: "Date", key: "date", width: 12 },
      { header: "Customer", key: "customerName", width: 28 },
      { header: "Reason", key: "cancelReason", width: 32 },
      { header: "Was", key: "grossAmount", width: 14, style: { numFmt: MONEY } },
    ];
    cancelled.getRow(1).font = { bold: true };
    for (const c of report.cancelled) cancelled.addRow({ ...c, date: day(c.invoiceDate) });
  }

  const input = workbook.addWorksheet("Input GST");
  input.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Source", key: "source", width: 16 },
    { header: "Details", key: "details", width: 36 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: MONEY } },
    { header: "GST", key: "gst", width: 12, style: { numFmt: MONEY } },
  ];
  input.getRow(1).font = { bold: true };
  for (const c of report.costs) {
    input.addRow({
      date: day(c.date),
      source: "Cost",
      details: [c.description || c.category.name, c.business.name].filter(Boolean).join(" · "),
      amount: c.grossAmount,
      gst: c.gstAmount,
    });
  }
  for (const f of report.fees) {
    input.addRow({
      date: day(f.paidOn),
      source: `${f.gateway ?? "Gateway"} fee`,
      details: `${f.invoice.customerName} · ${f.invoice.invoiceNumber}`,
      amount: f.feeAmount,
      gst: f.feeGstAmount,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const label = businessIds.length === 1 ? (scope.businesses.find((b) => b.id === businessIds[0])?.slug ?? "business") : "grateful";
  const lastDay = new Date(report.range.end.getTime() - 86_400_000);
  const name = `gst-${label}-${day(report.range.start)}-to-${day(lastDay)}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
});
