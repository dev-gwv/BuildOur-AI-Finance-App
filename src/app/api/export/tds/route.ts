import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { getScope, type Scope } from "@/server/scope";
import { parseListPeriod } from "@/components/invoices/listPeriods";
import { loadTdsReport } from "@/app/(app)/reports/tds/tdsData";

const MONEY = "#,##0.00";
// Stored dates are calendar days at midnight UTC, so ISO gives the right day.
const day = (d: Date) => d.toISOString().slice(0, 10);

/** TDS receivable as a workbook, for matching against Form 26AS: by deductor, and every deduction. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const period = parseListPeriod(searchParams.get("period") ?? "fy");
  const scope = await getScope(user);
  // Narrow to one business only when it's one the user can see; otherwise the whole scope.
  const requested = searchParams.get("businessId");
  const one = requested ? scope.businesses.find((b) => b.id === requested) : undefined;
  const narrowed: Scope = one ? { ...scope, current: one } : scope;
  const report = await loadTdsReport(narrowed, period);

  const workbook = new ExcelJS.Workbook();

  const byDeductor = workbook.addWorksheet("By deductor");
  byDeductor.columns = [
    { header: "Customer", key: "customer", width: 34 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Sections", key: "sections", width: 14 },
    { header: "Payments", key: "count", width: 10 },
    { header: "Settled", key: "settled", width: 16, style: { numFmt: MONEY } },
    { header: "TDS", key: "tds", width: 14, style: { numFmt: MONEY } },
  ];
  byDeductor.getRow(1).font = { bold: true };
  for (const g of report.groups) {
    byDeductor.addRow({ customer: g.customerName, gstin: g.customerGstin ?? "", sections: g.sections.join(", "), count: g.count, settled: g.settled, tds: g.tds });
  }
  byDeductor.addRow({});
  byDeductor.addRow({ customer: "TOTAL", tds: report.total }).font = { bold: true };

  const rows = workbook.addWorksheet("Deductions");
  rows.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Customer", key: "customer", width: 34 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Invoice", key: "invoice", width: 18 },
    { header: "Business", key: "business", width: 22 },
    { header: "Section", key: "section", width: 10 },
    { header: "Settled", key: "settled", width: 16, style: { numFmt: MONEY } },
    { header: "TDS", key: "tds", width: 14, style: { numFmt: MONEY } },
  ];
  rows.getRow(1).font = { bold: true };
  for (const r of report.rows) {
    rows.addRow({
      date: day(r.paidOn),
      customer: r.customerName,
      gstin: r.customerGstin ?? "",
      invoice: r.invoiceNumber,
      business: r.business.name,
      section: r.tdsSection,
      settled: r.amount,
      tds: r.tdsAmount,
    });
  }
  for (const sheet of [byDeductor, rows]) sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = `${narrowed.current ? `-${narrowed.current.slug}` : ""}-${period}`;
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tds-receivable${suffix}.xlsx"`,
    },
  });
});
