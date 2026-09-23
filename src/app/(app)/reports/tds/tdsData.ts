import { prisma } from "@/lib/prisma";
import { scopeWhere, type Scope } from "@/server/scope";
import { periodFilter, type ListPeriodKey } from "@/components/invoices/listPeriods";

/**
 * TDS withheld by customers: tax they paid to the government on our behalf
 * when paying an invoice. It's claimed back against the TDS credit shown in
 * Form 26AS / AIS, so this is grouped the way that form is read — by the
 * deductor (customer and their GSTIN), then by section.
 */

export interface TdsRow {
  paymentId: string;
  paidOn: Date;
  tdsAmount: number;
  tdsSection: string;
  /** What the payment settled in total (cash + TDS). */
  amount: number;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  customerGstin: string | null;
  business: { name: string; color: string };
}

export interface TdsGroup {
  key: string;
  customerName: string;
  customerGstin: string | null;
  count: number;
  tds: number;
  settled: number;
  sections: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function loadTdsReport(scope: Scope, period: ListPeriodKey) {
  const dates = periodFilter(period);
  const payments = await prisma.payment.findMany({
    where: {
      kind: "RECEIPT",
      tdsAmount: { gt: 0 },
      invoice: scopeWhere(scope),
      ...(dates ? { paidOn: dates } : {}),
    },
    orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      paidOn: true,
      amount: true,
      tdsAmount: true,
      tdsSection: true,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          customerGstin: true,
          business: { select: { name: true, color: true } },
        },
      },
    },
  });

  const rows: TdsRow[] = payments.map((p) => ({
    paymentId: p.id,
    paidOn: p.paidOn,
    tdsAmount: p.tdsAmount,
    tdsSection: p.tdsSection ?? "Other",
    amount: p.amount,
    invoiceId: p.invoice.id,
    invoiceNumber: p.invoice.invoiceNumber,
    customerName: p.invoice.customerName,
    customerGstin: p.invoice.customerGstin,
    business: p.invoice.business,
  }));

  // Grouped by deductor: the GSTIN when there is one (the same customer can be
  // spelled differently on two invoices), else the name.
  const groups = new Map<string, TdsGroup>();
  for (const r of rows) {
    const key = r.customerGstin ?? `name:${r.customerName.trim().toLowerCase()}`;
    const g = groups.get(key) ?? { key, customerName: r.customerName, customerGstin: r.customerGstin, count: 0, tds: 0, settled: 0, sections: [] };
    g.count += 1;
    g.tds = round2(g.tds + r.tdsAmount);
    g.settled = round2(g.settled + r.amount);
    if (!g.sections.includes(r.tdsSection)) g.sections.push(r.tdsSection);
    groups.set(key, g);
  }

  const bySection = new Map<string, number>();
  for (const r of rows) bySection.set(r.tdsSection, round2((bySection.get(r.tdsSection) ?? 0) + r.tdsAmount));

  return {
    rows,
    groups: [...groups.values()].sort((a, b) => b.tds - a.tds),
    sections: [...bySection.entries()].map(([section, tds]) => ({ section, tds })).sort((a, b) => b.tds - a.tds),
    total: round2(rows.reduce((s, r) => s + r.tdsAmount, 0)),
  };
}
