import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireUser, withApiErrors } from "@/lib/api-auth";
import { monthLabel, parseGstPeriod, type GstLine } from "@/lib/gstReport";
import { loadGstReport, parseGstScope } from "@/lib/gstReportData";

const MONEY = "#,##0.00";
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The GST report as a workbook for the CA: summary, B2B, B2C and input GST. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const period = parseGstPeriod(searchParams.get("period") ?? undefined);
  const scope = parseGstScope(searchParams.get("venture") ?? undefined);
  const report = await loadGstReport(user, period, scope);

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
  for (const m of report.months) {
    summary.addRow({ period: monthLabel(m.month), type: "B2B", ...m.b2b });
    summary.addRow({ period: monthLabel(m.month), type: "B2C", ...m.b2c });
  }
  summary.addRow({});
  summary.addRow({ period: "TOTAL OUTPUT", ...report.output }).font = { bold: true };
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
    { header: "Venture", key: "venture", width: 10 },
    { header: "Taxable value", key: "taxable", width: 14, style: { numFmt: MONEY } },
    { header: "Rate %", key: "gstPercent", width: 8 },
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
      sheet.addRow({ ...l, date: day(l.invoiceDate), customerGstin: l.customerGstin ?? "", venture: l.venture ?? "" });
    }
  };
  addInvoices("B2B", report.lines.filter((l) => l.b2b));
  addInvoices("B2C", report.lines.filter((l) => !l.b2b));

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
      details: [c.description || c.category.name, c.venture].filter(Boolean).join(" · "),
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
  const name = `gst-${scope ?? "grateful"}-${day(report.range.start)}-to-${day(new Date(report.range.end.getTime() - 86_400_000))}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
});
