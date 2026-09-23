import { prisma } from "./prisma";
import { getAccessibleCompanyIds, type SessionUser } from "./access";
import { gstLine, gstPeriodRange, inputGst, monthlySummary, netGstPayable, sumLines, type GstPeriodKey } from "./gstReport";
import type { Prisma } from "@/generated/prisma/client";

/** Which of Grateful's invoices to report: one venture, the pre-venture ones, or all. */
export type GstScope = "IPC" | "IWC" | "legacy" | null;

export function parseGstScope(value: string | undefined): GstScope {
  return value === "IPC" || value === "IWC" || value === "legacy" ? value : null;
}

/**
 * Everything the GST report and its export show, for one period and scope.
 * Only Grateful invoices carry GST — Mulberry isn't registered.
 */
export async function loadGstReport(user: SessionUser, period: GstPeriodKey, scope: GstScope) {
  const range = gstPeriodRange(period, new Date());
  const within = { gte: range.start, lt: range.end };

  const ventureWhere: Prisma.InvoiceWhereInput =
    scope === "legacy" ? { venture: null } : scope ? { venture: scope } : {};
  // Input credit belongs to Grateful's GSTIN, so Mulberry-tagged costs never count.
  const costVenture: Prisma.ExpenseWhereInput =
    scope === "legacy"
      ? { venture: null }
      : scope
        ? { venture: scope }
        : { OR: [{ venture: null }, { venture: { in: ["IPC", "IWC"] } }] };

  const accessible = await getAccessibleCompanyIds(user);
  const companyFilter: Prisma.ExpenseWhereInput = accessible === "ALL" ? {} : { companyId: { in: accessible } };

  const [invoices, costs, fees] = await Promise.all([
    prisma.invoice.findMany({
      where: { brand: "GRATEFUL", invoiceDate: within, ...ventureWhere },
      orderBy: { invoiceDate: "asc" },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        customerName: true,
        customerGstin: true,
        placeOfSupply: true,
        grossAmount: true,
        gstPercent: true,
        qty: true,
        venture: true,
      },
    }),
    prisma.expense.findMany({
      where: { direction: "OUT", date: within, gstAmount: { gt: 0 }, ...companyFilter, ...costVenture },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        description: true,
        grossAmount: true,
        gstPercent: true,
        gstAmount: true,
        venture: true,
        category: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { paidOn: within, feeGstAmount: { gt: 0 }, invoice: { brand: "GRATEFUL", ...ventureWhere } },
      orderBy: { paidOn: "asc" },
      select: {
        id: true,
        paidOn: true,
        gateway: true,
        feeAmount: true,
        feeGstAmount: true,
        invoice: { select: { invoiceNumber: true, customerName: true } },
      },
    }),
  ]);

  const lines = invoices.map(gstLine);
  const output = sumLines(lines);
  const input = inputGst(
    costs.map((c) => c.gstAmount),
    fees.map((f) => f.feeGstAmount)
  );

  return {
    range,
    lines,
    months: monthlySummary(lines),
    output,
    b2b: sumLines(lines.filter((l) => l.b2b)),
    b2c: sumLines(lines.filter((l) => !l.b2b)),
    costs,
    fees,
    input,
    netPayable: netGstPayable(output, input),
  };
}
