import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany, getAccessibleCompanyIds } from "@/lib/access";
import { LEDGERS, ledgerForInvoice, parseLedger, type LedgerKey } from "@/lib/ventures";
import type { Prisma } from "@/generated/prisma/client";

/** The invoices whose money lands in a given workbook. */
function invoiceScope(ledger: LedgerKey | null): Prisma.InvoiceWhereInput {
  if (!ledger) return {};
  if (ledger === "MULBERRY") return { brand: "MULBERRY" };
  return { brand: "GRATEFUL", venture: ledger };
}

const DIRECTION_LABEL: Record<string, string> = { IN: "Money in", OUT: "Money out" };
const MONEY_FORMAT = "#,##0.00";

function styleHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function moneyColumns(sheet: ExcelJS.Worksheet, keys: string[]) {
  for (const key of keys) sheet.getColumn(key).numFmt = MONEY_FORMAT;
}

export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const accessible = await getAccessibleCompanyIds(user);

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const venture = parseLedger(searchParams.get("venture"));
  const directionParam = searchParams.get("direction");
  const direction = directionParam === "IN" || directionParam === "OUT" ? directionParam : null;

  if (companyId && !(await canAccessCompany(user, companyId))) {
    throw new ApiError(403, "No access to this company");
  }

  const companyFilter = companyId
    ? { companyId }
    : accessible === "ALL"
      ? {}
      : { companyId: { in: accessible } };

  const range =
    from || to ? { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } : undefined;

  const [expenses, invoices, payments] = await Promise.all([
    prisma.expense.findMany({
      where: {
        ...companyFilter,
        ...(range ? { date: range } : {}),
        ...(venture ? { venture } : {}),
        ...(direction ? { direction } : {}),
      },
      orderBy: { date: "asc" },
      include: { company: true, category: true, gateway: true },
    }),
    prisma.invoice.findMany({
      where: { ...invoiceScope(venture), ...(range ? { invoiceDate: range } : {}) },
      orderBy: { invoiceDate: "asc" },
      include: { payments: { select: { amount: true } } },
    }),
    prisma.payment.findMany({
      where: { invoice: invoiceScope(venture), ...(range ? { paidOn: range } : {}) },
      orderBy: { paidOn: "asc" },
      include: { invoice: { select: { brand: true, venture: true, invoiceNumber: true, customerName: true } } },
    }),
  ]);

  const workbook = new ExcelJS.Workbook();

  // --- Summary: money in and money out kept apart, per company and category ---
  const summarySheet = workbook.addWorksheet("P&L Summary");
  summarySheet.columns = [
    { header: "Direction", key: "direction", width: 12 },
    { header: "Company", key: "company", width: 24 },
    { header: "Category", key: "category", width: 24 },
    { header: "Gross (incl. GST)", key: "gross", width: 16 },
    { header: "Gateway charges", key: "gatewayCharge", width: 16 },
    { header: "GST", key: "gst", width: 14 },
    { header: "Net", key: "net", width: 14 },
  ];
  styleHeader(summarySheet);
  moneyColumns(summarySheet, ["gross", "gatewayCharge", "gst", "net"]);

  type SummaryRow = { direction: string; company: string; category: string; gross: number; gatewayCharge: number; gst: number; net: number };
  const summaryMap = new Map<string, SummaryRow>();
  for (const e of expenses) {
    const key = `${e.direction}||${e.company.name}||${e.category.name}`;
    const row = summaryMap.get(key) ?? {
      direction: DIRECTION_LABEL[e.direction] ?? e.direction,
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
  const summaryRows = [...summaryMap.values()].sort((a, b) => a.direction.localeCompare(b.direction));
  for (const row of summaryRows) summarySheet.addRow(row);

  for (const dir of ["IN", "OUT"] as const) {
    const rows = expenses.filter((e) => e.direction === dir);
    if (rows.length === 0) continue;
    const total = rows.reduce(
      (acc, e) => ({
        gross: acc.gross + e.grossAmount,
        gatewayCharge: acc.gatewayCharge + e.gatewayChargeAmount,
        gst: acc.gst + e.gstAmount,
        net: acc.net + e.netAmount,
      }),
      { gross: 0, gatewayCharge: 0, gst: 0, net: 0 }
    );
    summarySheet.addRow({});
    summarySheet.addRow({ direction: `TOTAL ${DIRECTION_LABEL[dir].toUpperCase()}`, ...total }).font = { bold: true };
  }

  // --- Every ledger entry ---
  const transactionsSheet = workbook.addWorksheet("Money in & out");
  transactionsSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Direction", key: "direction", width: 12 },
    { header: "Venture", key: "venture", width: 18 },
    { header: "Company", key: "company", width: 20 },
    { header: "Category", key: "category", width: 20 },
    { header: "Description", key: "description", width: 26 },
    { header: "Gross (incl. GST)", key: "gross", width: 16 },
    { header: "Gateway", key: "gateway", width: 16 },
    { header: "Gateway charge", key: "gatewayCharge", width: 14 },
    { header: "GST %", key: "gstPercent", width: 8 },
    { header: "GST amount", key: "gstAmount", width: 12 },
    { header: "Net", key: "net", width: 14 },
  ];
  styleHeader(transactionsSheet);
  moneyColumns(transactionsSheet, ["gross", "gatewayCharge", "gstAmount", "net"]);
  for (const e of expenses) {
    const ledger = parseLedger(e.venture);
    transactionsSheet.addRow({
      date: e.date.toISOString().slice(0, 10),
      direction: DIRECTION_LABEL[e.direction] ?? e.direction,
      venture: ledger ? LEDGERS[ledger].label : "",
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

  // --- Invoices, with what's been collected against each ---
  const invoicesSheet = workbook.addWorksheet("Invoices");
  invoicesSheet.columns = [
    { header: "Invoice #", key: "number", width: 18 },
    { header: "Date", key: "date", width: 12 },
    { header: "Customer", key: "customer", width: 28 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Business", key: "business", width: 20 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Collected", key: "collected", width: 14 },
    { header: "Balance", key: "balance", width: 14 },
  ];
  styleHeader(invoicesSheet);
  moneyColumns(invoicesSheet, ["amount", "collected", "balance"]);
  for (const inv of invoices) {
    const collected = inv.payments.reduce((s, p) => s + p.amount, 0);
    const ledger = ledgerForInvoice(inv);
    invoicesSheet.addRow({
      number: inv.invoiceNumber,
      date: inv.invoiceDate.toISOString().slice(0, 10),
      customer: inv.customerName,
      gstin: inv.customerGstin ?? "",
      business: ledger ? LEDGERS[ledger].label : "Grateful (no venture)",
      amount: inv.grossAmount,
      collected,
      balance: Math.round((inv.grossAmount - collected) * 100) / 100,
    });
  }

  // --- Payments received, with gateway fees taken out ---
  const paymentsSheet = workbook.addWorksheet("Payments");
  paymentsSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Invoice #", key: "invoice", width: 18 },
    { header: "Customer", key: "customer", width: 28 },
    { header: "Business", key: "business", width: 20 },
    { header: "Method", key: "method", width: 16 },
    { header: "Gateway", key: "gateway", width: 14 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Gateway fees (incl. GST)", key: "fees", width: 20 },
    { header: "Net received", key: "net", width: 14 },
  ];
  styleHeader(paymentsSheet);
  moneyColumns(paymentsSheet, ["amount", "fees", "net"]);
  for (const p of payments) {
    const fees = p.feeAmount + p.feeGstAmount;
    const ledger = ledgerForInvoice(p.invoice);
    paymentsSheet.addRow({
      date: p.paidOn.toISOString().slice(0, 10),
      invoice: p.invoice.invoiceNumber,
      customer: p.invoice.customerName,
      business: ledger ? LEDGERS[ledger].label : "Grateful (no venture)",
      method: p.method ?? "",
      gateway: p.gateway ?? "",
      amount: p.amount,
      fees,
      net: Math.round((p.amount - fees) * 100) / 100,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const scope = venture ? `-${venture.toLowerCase()}` : "";

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pnl-export${scope}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});
