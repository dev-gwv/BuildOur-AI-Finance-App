import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { accessibleBusinessIds, accessWhere, assertBusinessAccess } from "@/server/access";
import { id, isoDate, parseInput } from "@/server/validation";

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
  const sp = new URL(req.url).searchParams;
  const { businessId, from, to, direction } = parseInput(
    z.object({
      businessId: id.optional(),
      from: isoDate("From").optional(),
      to: isoDate("To").optional(),
      direction: z.enum(["IN", "OUT"]).optional(),
    }),
    Object.fromEntries([...sp.entries()].filter(([, v]) => v !== ""))
  );

  if (businessId) await assertBusinessAccess(user, businessId);
  const scope = businessId ? { businessId } : accessWhere(await accessibleBusinessIds(user));

  // `to` is inclusive: the whole of that day.
  const range =
    from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } : undefined;

  const [expenses, invoices, payments] = await Promise.all([
    prisma.expense.findMany({
      where: {
        ...scope,
        ...(range ? { date: range } : {}),
        ...(direction ? { direction } : {}),
      },
      orderBy: { date: "asc" },
      include: { business: true, category: true, gateway: true },
    }),
    prisma.invoice.findMany({
      where: { ...scope, ...(range ? { invoiceDate: range } : {}) },
      orderBy: { invoiceDate: "asc" },
      include: { payments: { select: { amount: true } }, business: { select: { name: true } } },
    }),
    prisma.payment.findMany({
      where: { invoice: scope, ...(range ? { paidOn: range } : {}) },
      orderBy: { paidOn: "asc" },
      include: { invoice: { select: { invoiceNumber: true, customerName: true, business: { select: { name: true } } } } },
    }),
  ]);

  const workbook = new ExcelJS.Workbook();

  // --- Summary: money in and money out kept apart, per business and category ---
  const summarySheet = workbook.addWorksheet("P&L Summary");
  summarySheet.columns = [
    { header: "Direction", key: "direction", width: 12 },
    { header: "Business", key: "company", width: 24 },
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
    const key = `${e.direction}||${e.business.name}||${e.category.name}`;
    const row = summaryMap.get(key) ?? {
      direction: DIRECTION_LABEL[e.direction] ?? e.direction,
      company: e.business.name,
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
    { header: "Business", key: "company", width: 22 },
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
    transactionsSheet.addRow({
      date: e.date.toISOString().slice(0, 10),
      direction: DIRECTION_LABEL[e.direction] ?? e.direction,
      company: e.business.name,
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
    invoicesSheet.addRow({
      number: inv.invoiceNumber,
      date: inv.invoiceDate.toISOString().slice(0, 10),
      customer: inv.customerName,
      gstin: inv.customerGstin ?? "",
      business: inv.business.name,
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
    paymentsSheet.addRow({
      date: p.paidOn.toISOString().slice(0, 10),
      invoice: p.invoice.invoiceNumber,
      customer: p.invoice.customerName,
      business: p.invoice.business.name,
      method: p.method ?? "",
      gateway: p.gateway ?? "",
      amount: p.amount,
      fees,
      net: Math.round((p.amount - fees) * 100) / 100,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const slug = businessId ? (await prisma.business.findUnique({ where: { id: businessId }, select: { slug: true } }))?.slug : null;
  const suffix = slug ? `-${slug}` : "";

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pnl-export${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});
