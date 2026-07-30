import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany, getAccessibleCompanyIds } from "@/lib/access";

export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const accessible = await getAccessibleCompanyIds(user);

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (companyId && !(await canAccessCompany(user, companyId))) {
    throw new ApiError(403, "No access to this company");
  }

  const companyFilter = companyId
    ? { companyId }
    : accessible === "ALL"
      ? {}
      : { companyId: { in: accessible } };

  const dateFilter =
    from || to
      ? {
          date: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const expenses = await prisma.expense.findMany({
    where: { ...companyFilter, ...dateFilter },
    orderBy: { date: "asc" },
    include: { company: true, category: true, gateway: true },
  });

  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("P&L Summary");
  summarySheet.columns = [
    { header: "Company", key: "company", width: 24 },
    { header: "Category", key: "category", width: 24 },
    { header: "Gross", key: "gross", width: 14 },
    { header: "Gateway charges", key: "gatewayCharge", width: 16 },
    { header: "GST", key: "gst", width: 14 },
    { header: "Net revenue", key: "net", width: 14 },
  ];
  summarySheet.getRow(1).font = { bold: true };

  const summaryKey = (companyName: string, categoryName: string) => `${companyName}||${categoryName}`;
  const summaryMap = new Map<
    string,
    { company: string; category: string; gross: number; gatewayCharge: number; gst: number; net: number }
  >();
  for (const e of expenses) {
    const key = summaryKey(e.company.name, e.category.name);
    const row = summaryMap.get(key) ?? {
      company: e.company.name,
      category: e.category.name,
      gross: 0,
      gatewayCharge: 0,
      gst: 0,
      net: 0,
    };
    row.gross += e.grossAmount;
    row.gatewayCharge += e.gatewayChargeAmount;
    row.gst += e.gstAmount;
    row.net += e.netAmount;
    summaryMap.set(key, row);
  }
  for (const row of summaryMap.values()) {
    summarySheet.addRow(row);
  }
  const totals = expenses.reduce(
    (acc, e) => {
      acc.gross += e.grossAmount;
      acc.gatewayCharge += e.gatewayChargeAmount;
      acc.gst += e.gstAmount;
      acc.net += e.netAmount;
      return acc;
    },
    { gross: 0, gatewayCharge: 0, gst: 0, net: 0 }
  );
  summarySheet.addRow({});
  const totalRow = summarySheet.addRow({ company: "TOTAL", category: "", ...totals });
  totalRow.font = { bold: true };

  const expensesSheet = workbook.addWorksheet("Expenses");
  expensesSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Company", key: "company", width: 20 },
    { header: "Category", key: "category", width: 20 },
    { header: "Description", key: "description", width: 24 },
    { header: "Gross", key: "gross", width: 12 },
    { header: "Gateway", key: "gateway", width: 16 },
    { header: "Gateway charge", key: "gatewayCharge", width: 14 },
    { header: "GST %", key: "gstPercent", width: 10 },
    { header: "GST amount", key: "gstAmount", width: 12 },
    { header: "Net revenue", key: "net", width: 14 },
  ];
  expensesSheet.getRow(1).font = { bold: true };
  for (const e of expenses) {
    expensesSheet.addRow({
      date: e.date.toISOString().slice(0, 10),
      company: e.company.name,
      category: e.category.name,
      description: e.description ?? "",
      gross: e.grossAmount,
      gateway: e.gateway?.name ?? "",
      gatewayCharge: e.gatewayChargeAmount,
      gstPercent: e.gstPercent,
      gstAmount: e.gstAmount,
      net: e.netAmount,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pnl-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});
