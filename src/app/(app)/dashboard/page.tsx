import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  FileText,
  HandCoins,
  Hourglass,
  Plus,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAccessibleCompanyIds } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { DonutBreakdown, MoneyFlowChart, StackedMonthlyChart, type SeriesDef } from "@/components/DashboardCharts";
import { AlertsBanner } from "@/components/AlertsBanner";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatCompactINR, formatCurrencyWhole, formatDate } from "@/lib/format";
import { totalsByPlatform } from "@/lib/invoiceCalc";
import { LEDGERS, LEDGER_KEYS, invoiceHref, ledgerForInvoice, parseLedger, type LedgerKey } from "@/lib/ventures";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Periods. Indian financial year (April–March) and its quarters, since that's
// what the books, GST returns and the sheets are all kept against.

const PERIODS = [
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This FY" },
  { key: "12m", label: "12 months" },
  { key: "all", label: "All time" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"] | "custom";

type Range = { start: Date; end: Date } | null;

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function resolvePeriod(period: PeriodKey, from: string | undefined, to: string | undefined, now: Date) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let current: Range = null;
  switch (period) {
    case "month":
      current = { start: monthStart, end: addMonths(monthStart, 1) };
      break;
    case "lastmonth":
      current = { start: addMonths(monthStart, -1), end: monthStart };
      break;
    case "quarter": {
      const start = addMonths(monthStart, -(((now.getMonth() + 9) % 12) % 3));
      current = { start, end: addMonths(start, 3) };
      break;
    }
    case "fy": {
      const start = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
      current = { start, end: addMonths(start, 12) };
      break;
    }
    case "12m":
      current = { start: addMonths(monthStart, -11), end: addMonths(monthStart, 1) };
      break;
    case "custom": {
      const start = from ? new Date(from) : new Date(2000, 0, 1);
      const end = to ? new Date(new Date(to).getTime() + 86_400_000) : addMonths(monthStart, 1);
      current = { start, end };
      break;
    }
    case "all":
      current = null;
  }
  // The same length of time immediately before, for the change figures.
  const previous: Range = current
    ? { start: new Date(2 * current.start.getTime() - current.end.getTime()), end: current.start }
    : null;
  return { current, previous };
}

const within = (r: Range) => (r ? { gte: r.start, lt: r.end } : undefined);

function change(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

// ---------------------------------------------------------------------------

/** The invoices whose money lands in a given workbook. */
function invoiceScope(ledger: LedgerKey | null): Prisma.InvoiceWhereInput {
  if (!ledger) return {};
  if (ledger === "MULBERRY") return { brand: "MULBERRY" };
  return { brand: "GRATEFUL", venture: ledger };
}

const LEDGER_COLORS: Record<LedgerKey | "LEGACY", string> = {
  IPC: "#6a6cf0",
  IWC: "#0ea5e9",
  MULBERRY: "#f43f5e",
  LEGACY: "#a3a3a3",
};

function greeting(now: Date) {
  // Server time is UTC; the business runs on IST.
  const hour = (now.getUTCHours() + 5.5) % 24;
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; from?: string; to?: string; venture?: string; period?: string }>;
}) {
  const params = await searchParams;
  const { companyId, from, to } = params;
  const venture = parseLedger(params.venture);
  const period: PeriodKey =
    from || to ? "custom" : (PERIODS.find((p) => p.key === params.period)?.key ?? "fy");

  const user = await requireSessionUser();
  const accessible = await getAccessibleCompanyIds(user);
  const now = new Date();
  const { current, previous } = resolvePeriod(period, from, to, now);

  const companyFilter = companyId
    ? { companyId }
    : accessible === "ALL"
      ? {}
      : { companyId: { in: accessible } };
  const expenseScope: Prisma.ExpenseWhereInput = { ...companyFilter, ...(venture ? { venture } : {}) };
  const scope = invoiceScope(venture);

  // The chart always shows at least six months so a single-month period still has context.
  const chartEnd = current?.end ?? addMonths(new Date(now.getFullYear(), now.getMonth(), 1), 1);
  const chartStart = current && current.start < addMonths(chartEnd, -6) ? current.start : addMonths(chartEnd, -6);
  const chartFrom = period === "all" ? undefined : chartStart;

  const expenseSums = { grossAmount: true, gatewayChargeAmount: true } as const;
  const paymentSums = { amount: true, feeAmount: true, feeGstAmount: true } as const;

  const [
    companies,
    invoicedNow,
    paymentsNow,
    paymentsPrev,
    openInvoices,
    chartPayments,
    chartLedger,
    expenses,
    ledgerPrev,
    recentInvoices,
    recentPayments,
  ] = await Promise.all([
    prisma.company.findMany({
      where: accessible === "ALL" ? {} : { id: { in: accessible } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.invoice.aggregate({
      where: { ...scope, invoiceDate: within(current) },
      _sum: { grossAmount: true },
      _count: true,
    }),
    prisma.payment.findMany({
      where: { invoice: scope, paidOn: within(current) },
      select: { amount: true, method: true, feeAmount: true, feeGstAmount: true },
    }),
    previous ? prisma.payment.aggregate({ where: { invoice: scope, paidOn: within(previous) }, _sum: paymentSums }) : null,
    // Dues are a balance, not a flow: every invoice ever raised that isn't settled.
    prisma.invoice.findMany({
      where: scope,
      select: {
        id: true,
        brand: true,
        venture: true,
        invoiceNumber: true,
        customerName: true,
        invoiceDate: true,
        dueDate: true,
        grossAmount: true,
        payments: { select: { amount: true } },
      },
    }),
    prisma.payment.findMany({
      where: { invoice: scope, ...(chartFrom ? { paidOn: { gte: chartFrom, lt: chartEnd } } : {}) },
      select: {
        amount: true,
        feeAmount: true,
        feeGstAmount: true,
        paidOn: true,
        invoice: { select: { brand: true, venture: true } },
      },
    }),
    prisma.expense.findMany({
      where: { ...expenseScope, ...(chartFrom ? { date: { gte: chartFrom, lt: chartEnd } } : {}) },
      select: { date: true, direction: true, grossAmount: true, gatewayChargeAmount: true },
    }),
    prisma.expense.findMany({
      where: { ...expenseScope, date: within(current) },
      select: {
        direction: true,
        grossAmount: true,
        gatewayChargeAmount: true,
        gstAmount: true,
        netAmount: true,
        category: { select: { name: true } },
      },
    }),
    previous
      ? prisma.expense.groupBy({
          by: ["direction"],
          where: { ...expenseScope, date: within(previous) },
          _sum: expenseSums,
        })
      : null,
    prisma.invoice.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, brand: true, venture: true, invoiceNumber: true, customerName: true, grossAmount: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: { invoice: scope },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        amount: true,
        method: true,
        paidOn: true,
        createdAt: true,
        invoice: { select: { id: true, brand: true, venture: true, customerName: true, invoiceNumber: true } },
      },
    }),
  ]);

  // --- Headline figures ---
  // Profit is cash, GST included (it's what the sheets add up):
  //   invoice collections − gateway fees on them (+ the GST on those fees)
  //   + ledger money in − its gateway charges − ledger money out.
  const invoicedTotal = invoicedNow._sum.grossAmount ?? 0;
  const receivedTotal = paymentsNow.reduce((s, p) => s + p.amount, 0);
  const paymentFees = paymentsNow.reduce((s, p) => s + p.feeAmount + p.feeGstAmount, 0);

  const ledgerIn = expenses.filter((e) => e.direction !== "OUT");
  const ledgerOut = expenses.filter((e) => e.direction === "OUT");
  const inGross = ledgerIn.reduce((s, e) => s + e.grossAmount, 0);
  const inCharges = ledgerIn.reduce((s, e) => s + e.gatewayChargeAmount, 0);
  const outGross = ledgerOut.reduce((s, e) => s + e.grossAmount, 0);
  const gatewayFees = paymentFees + inCharges;
  const profit = receivedTotal - paymentFees + inGross - inCharges - outGross;

  const prevIn = ledgerPrev?.find((g) => g.direction !== "OUT")?._sum;
  const prevOutGross = ledgerPrev?.find((g) => g.direction === "OUT")?._sum.grossAmount ?? 0;
  const prevReceived = paymentsPrev?._sum.amount ?? 0;
  const prevProfit = previous
    ? prevReceived -
      (paymentsPrev?._sum.feeAmount ?? 0) -
      (paymentsPrev?._sum.feeGstAmount ?? 0) +
      (prevIn?.grossAmount ?? 0) -
      (prevIn?.gatewayChargeAmount ?? 0) -
      prevOutGross
    : null;

  const open = openInvoices
    .map((inv) => {
      const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
      return { ...inv, balance: Math.round((inv.grossAmount - paid) * 100) / 100 };
    })
    .filter((inv) => inv.balance > 0.5)
    .sort((a, b) => b.balance - a.balance);
  const outstandingTotal = open.reduce((s, i) => s + i.balance, 0);
  const overdue = open.filter((i) => i.dueDate < now);

  // --- Collections by month, stacked per workbook; and money in vs out ---
  const seriesKeys: Array<LedgerKey | "LEGACY"> = venture ? [venture] : [...LEDGER_KEYS, "LEGACY"];
  const buckets = new Map<string, Record<string, number>>();
  const flows = new Map<string, { in: number; out: number; fees: number }>();
  for (let d = new Date(chartStart); d < chartEnd; d = addMonths(d, 1)) buckets.set(monthKey(d), {});
  for (const p of chartPayments) {
    const key = monthKey(p.paidOn);
    const bucket = buckets.get(key) ?? {};
    const series = ledgerForInvoice(p.invoice) ?? "LEGACY";
    bucket[series] = (bucket[series] ?? 0) + p.amount;
    buckets.set(key, bucket);
    const f = flows.get(key) ?? { in: 0, out: 0, fees: 0 };
    f.in += p.amount;
    f.fees += p.feeAmount + p.feeGstAmount;
    flows.set(key, f);
  }
  for (const e of chartLedger) {
    const key = monthKey(e.date);
    if (!buckets.has(key)) buckets.set(key, {});
    const f = flows.get(key) ?? { in: 0, out: 0, fees: 0 };
    if (e.direction === "OUT") f.out += e.grossAmount;
    else {
      f.in += e.grossAmount;
      f.fees += e.gatewayChargeAmount;
    }
    flows.set(key, f);
  }
  // "All time" starts at the first entry; a quiet month still gets its (empty) bar.
  const keys = [...buckets.keys()].sort();
  if (keys.length > 1) {
    const [fy, fm] = keys[0].split("-").map(Number);
    for (let d = new Date(fy, fm - 1, 1); monthKey(d) < keys[keys.length - 1]; d = addMonths(d, 1)) {
      if (!buckets.has(monthKey(d))) buckets.set(monthKey(d), {});
    }
  }
  const monthKeys = [...buckets.keys()].sort();
  const chartData = monthKeys.map((key) => {
    const v = buckets.get(key) ?? {};
    return { label: monthLabel(key), ...Object.fromEntries(seriesKeys.map((s) => [s, v[s] ?? 0])) };
  });
  const flowData = monthKeys.map((key) => {
    const f = flows.get(key) ?? { in: 0, out: 0, fees: 0 };
    return { label: monthLabel(key), in: f.in - f.fees, out: f.out, profit: f.in - f.fees - f.out };
  });
  const usedSeries = seriesKeys.filter((s) => chartData.some((row) => (row as Record<string, number | string>)[s] as number > 0));
  const series: SeriesDef[] = (usedSeries.length ? usedSeries : seriesKeys).map((key) => ({
    key,
    label: key === "LEGACY" ? "Grateful (no venture)" : LEDGERS[key].label,
    color: LEDGER_COLORS[key],
  }));
  const receivedTrend = chartData.map((row) => seriesKeys.reduce((s, k) => s + Number((row as Record<string, number | string>)[k] ?? 0), 0));
  const profitTrend = flowData.map((f) => f.profit);

  // --- Per-workbook breakdown (the "All" view) ---
  const perLedger = venture
    ? []
    : await Promise.all(
        LEDGER_KEYS.map(async (key) => {
          const s = invoiceScope(key);
          const [inv, pay, ledger] = await Promise.all([
            prisma.invoice.aggregate({ where: { ...s, invoiceDate: within(current) }, _sum: { grossAmount: true }, _count: true }),
            prisma.payment.aggregate({ where: { invoice: s, paidOn: within(current) }, _sum: paymentSums }),
            prisma.expense.groupBy({
              by: ["direction"],
              where: { ...companyFilter, venture: key, date: within(current) },
              _sum: expenseSums,
            }),
          ]);
          const dues = open.filter((o) => ledgerForInvoice(o) === key).reduce((sum, o) => sum + o.balance, 0);
          const lIn = ledger.find((g) => g.direction !== "OUT")?._sum;
          const lOut = ledger.find((g) => g.direction === "OUT")?._sum.grossAmount ?? 0;
          const received = pay._sum.amount ?? 0;
          return {
            key,
            invoices: inv._count,
            invoiced: inv._sum.grossAmount ?? 0,
            received,
            outstanding: dues,
            moneyOut: lOut,
            profit:
              received -
              (pay._sum.feeAmount ?? 0) -
              (pay._sum.feeGstAmount ?? 0) +
              (lIn?.grossAmount ?? 0) -
              (lIn?.gatewayChargeAmount ?? 0) -
              lOut,
          };
        })
      );

  // --- Where money came in, and what the ledger holds ---
  const platforms = totalsByPlatform(paymentsNow).map(([name, value]) => ({ name, value }));
  const byCategory = (rows: typeof expenses, value: (e: (typeof expenses)[number]) => number) => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.category.name, (map.get(e.category.name) ?? 0) + value(e));
    return [...map.entries()].map(([name, v]) => ({ name, value: v })).sort((a, b) => b.value - a.value);
  };
  const costCategories = byCategory(ledgerOut, (e) => e.grossAmount);
  const inCategories = byCategory(ledgerIn, (e) => e.netAmount);
  const ledgerTotals = {
    inGross,
    inCharges: inCharges + ledgerIn.reduce((s, e) => s + e.gstAmount, 0),
    inNet: ledgerIn.reduce((s, e) => s + e.netAmount, 0),
    outGross,
    outGst: ledgerOut.reduce((s, e) => s + e.gstAmount, 0),
    outNet: ledgerOut.reduce((s, e) => s + e.netAmount, 0),
  };

  // --- Activity feed: invoices raised and money received, newest first ---
  const activity = [
    ...recentInvoices.map((i) => ({
      id: `i-${i.id}`,
      at: i.createdAt,
      kind: "invoice" as const,
      title: `${i.invoiceNumber} raised`,
      subtitle: i.customerName,
      amount: i.grossAmount,
      href: invoiceHref(i),
      ledger: ledgerForInvoice(i),
    })),
    ...recentPayments.map((p) => ({
      id: `p-${p.id}`,
      at: p.createdAt,
      kind: "payment" as const,
      title: `Received${p.method ? ` via ${p.method}` : ""}`,
      subtitle: `${p.invoice.customerName} · ${p.invoice.invoiceNumber}`,
      amount: p.amount,
      href: invoiceHref(p.invoice),
      ledger: ledgerForInvoice(p.invoice),
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);

  // --- URL helpers: every control keeps the others' state ---
  const query = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      venture: venture ?? undefined,
      period: period === "custom" ? undefined : period,
      companyId,
      from,
      to,
      ...overrides,
    };
    return Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>;
  };
  const periodLabel =
    period === "custom"
      ? `${from ? formatDate(from) : "start"} – ${to ? formatDate(to) : "today"}`
      : PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const scopeLabel = venture ? LEDGERS[venture].label : "all businesses";

  return (
    <div className="space-y-6">
      <AlertsBanner />

      <PageHeader
        eyebrow={now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        title={`${greeting(now)}, ${user.name?.split(" ")[0] ?? "there"}`}
        description={`Collections, dues, costs and profit for ${scopeLabel}, ${periodLabel}.`}
        actions={
          <Link
            href={venture === "MULBERRY" ? "/mulberry/new" : venture ? `/${venture.toLowerCase()}/new` : "/ipc/new"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-4 w-4" />
            New {venture ? LEDGERS[venture].label.replace(" Finance", "").replace(" Weddings", "") : "IPC"} invoice
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Segmented
          items={[
            { key: "all", label: "All", href: { pathname: "/dashboard", query: query({ venture: undefined }) }, active: !venture },
            ...LEDGER_KEYS.map((key) => ({
              key,
              label: (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: LEDGER_COLORS[key] }} />
                  {LEDGERS[key].label}
                </span>
              ),
              href: { pathname: "/dashboard", query: query({ venture: key }) },
              active: venture === key,
            })),
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            items={PERIODS.map((p) => ({
              key: p.key,
              label: p.label,
              href: { pathname: "/dashboard", query: query({ period: p.key, from: undefined, to: undefined }) },
              active: period === p.key,
            }))}
          />
          <details className="group relative">
            <summary
              className={`flex h-9 cursor-pointer list-none items-center rounded-xl border px-3 text-[13px] font-medium shadow-card ${
                period === "custom" || companyId
                  ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                  : "border-neutral-200/80 bg-white text-neutral-600 dark:border-white/[0.07] dark:bg-neutral-900/70 dark:text-neutral-300"
              }`}
            >
              More filters
            </summary>
            <form
              method="get"
              className="absolute right-0 z-10 mt-2 grid w-72 gap-3 rounded-xl border border-neutral-200/80 bg-white p-4 text-sm shadow-pop dark:border-white/10 dark:bg-neutral-900"
            >
              {venture && <input type="hidden" name="venture" value={venture} />}
              <label className="grid gap-1 text-xs font-medium text-neutral-500">
                Company (expenses)
                <select
                  name="companyId"
                  defaultValue={companyId ?? ""}
                  className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-100"
                >
                  <option value="">All companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-medium text-neutral-500">
                  From
                  <input
                    type="date"
                    name="from"
                    defaultValue={from ?? ""}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-neutral-500">
                  To
                  <input
                    type="date"
                    name="to"
                    defaultValue={to ?? ""}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                </label>
              </div>
              <div className="flex justify-between gap-2">
                <Link href={{ pathname: "/dashboard", query: venture ? { venture } : {} }} className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
                  Reset
                </Link>
                <button className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900">
                  Apply
                </button>
              </div>
            </form>
          </details>
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected"
          value={formatCurrencyWhole(receivedTotal)}
          icon={HandCoins}
          tone="success"
          delta={change(receivedTotal, previous ? prevReceived : null)}
          hint={`of ${formatCompactINR(invoicedTotal)} invoiced · ${invoicedNow._count} inv.`}
          trend={receivedTrend}
        />
        <StatCard
          label="Outstanding dues"
          value={formatCurrencyWhole(outstandingTotal)}
          icon={Hourglass}
          tone={overdue.length ? "danger" : "warning"}
          hint={open.length ? `${open.length} open · ${overdue.length} past due` : "Nothing owed right now"}
        />
        <StatCard
          label="Money out"
          value={formatCurrencyWhole(outGross)}
          icon={Receipt}
          delta={change(outGross, previous ? prevOutGross : null)}
          invertDelta
          hint={`${ledgerOut.length} cost${ledgerOut.length === 1 ? "" : "s"} · incl. GST`}
        />
        <StatCard
          label="Profit"
          value={formatCurrencyWhole(profit)}
          icon={TrendingUp}
          tone={profit >= 0 ? "success" : "danger"}
          delta={change(profit, prevProfit)}
          hint={`after ${formatCompactINR(gatewayFees)} gateway fees`}
          trend={profitTrend}
        />
      </div>

      {/* Collections chart + where it came in */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle
              title="Collections by month"
              subtitle={venture ? `Money received into ${LEDGERS[venture].label}` : "Money received, split by the sheet it's mirrored to"}
              action={
                <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-white">
                  {formatCompactINR(receivedTrend.reduce((s, v) => s + v, 0))}
                </span>
              }
            />
          </CardHeader>
          <CardBody>
            {chartPayments.length > 0 ? (
              <StackedMonthlyChart data={chartData} series={series} />
            ) : (
              <EmptyState icon={HandCoins} title="No payments in this window" description="Payments recorded against invoices appear here, month by month." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle
              title="Where it came in"
              subtitle={
                paymentFees > 0
                  ? `Payment platforms, ${periodLabel} · ${formatCurrencyWhole(paymentFees)} kept by gateways`
                  : `Payment platforms, ${periodLabel}`
              }
            />
          </CardHeader>
          <CardBody>
            {platforms.length > 0 ? (
              <DonutBreakdown data={platforms} centerLabel="Collected" />
            ) : (
              <EmptyState icon={Wallet} title="Nothing collected yet" />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Money in vs out */}
      <Card>
        <CardHeader>
          <CardTitle
            title="Profit by month"
            subtitle="Money in after gateway fees (invoice collections + ledger receipts) against money out"
            action={
              <span
                className={`text-lg font-semibold tabular-nums ${profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
              >
                {formatCompactINR(flowData.reduce((sum, f) => sum + f.profit, 0))}
              </span>
            }
          />
        </CardHeader>
        <CardBody>
          {flowData.some((f) => f.in !== 0 || f.out !== 0) ? (
            <MoneyFlowChart data={flowData} />
          ) : (
            <EmptyState icon={TrendingUp} title="No money in or out in this window" />
          )}
        </CardBody>
      </Card>

      {/* Per-business breakdown */}
      {!venture && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle title="By business" subtitle={`Each row matches its Google Sheet · ${periodLabel}`} />
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <TH>Business</TH>
                  <TH className="text-right">Invoiced</TH>
                  <TH className="text-right">Collected</TH>
                  <TH className="text-right">Outstanding</TH>
                  <TH className="text-right">Money out</TH>
                  <TH className="text-right">Profit</TH>
                  <TH className="w-40">Collection rate</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {perLedger.map((row) => {
                  const rate = row.invoiced > 0 ? Math.min(100, (row.received / row.invoiced) * 100) : null;
                  return (
                    <TR key={row.key}>
                      <TD>
                        <span className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
                          <span className="h-2 w-2 rounded-full" style={{ background: LEDGER_COLORS[row.key] }} />
                          {LEDGERS[row.key].label}
                          <span className="text-xs font-normal text-neutral-400">{row.invoices} inv.</span>
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums">{formatCurrencyWhole(row.invoiced)}</TD>
                      <TD className="text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                        {formatCurrencyWhole(row.received)}
                      </TD>
                      <TD className={`text-right tabular-nums ${row.outstanding > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                        {formatCurrencyWhole(row.outstanding)}
                      </TD>
                      <TD className="text-right tabular-nums">{formatCurrencyWhole(row.moneyOut)}</TD>
                      <TD
                        className={`text-right font-medium tabular-nums ${row.profit >= 0 ? "text-neutral-900 dark:text-white" : "text-red-600 dark:text-red-400"}`}
                      >
                        {formatCurrencyWhole(row.profit)}
                      </TD>
                      <TD>
                        {rate === null ? (
                          <span className="text-xs text-neutral-400">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/[0.06]">
                              <div className="h-full rounded-full" style={{ width: `${rate}%`, background: LEDGER_COLORS[row.key] }} />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums">{Math.round(rate)}%</span>
                          </div>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Link
                          href={{ pathname: "/dashboard", query: query({ venture: row.key }) }}
                          className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
                        >
                          Open <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Dues + activity */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader>
            <CardTitle
              title="Who owes you"
              subtitle="Open balances, largest first"
              action={open.length > 0 && <Badge tone={overdue.length ? "danger" : "warning"} dot>{formatCurrencyWhole(outstandingTotal)}</Badge>}
            />
          </CardHeader>
          {open.length === 0 ? (
            <CardBody>
              <EmptyState icon={CircleDollarSign} title="All settled" description="Every invoice in scope has been paid in full." />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <THead>
                  <tr>
                    <TH>Customer</TH>
                    <TH>Age</TH>
                    <TH className="text-right">Invoice</TH>
                    <TH className="text-right">Balance</TH>
                  </tr>
                </THead>
                <TBody>
                  {open.slice(0, 7).map((inv) => {
                    const days = Math.max(0, Math.floor((now.getTime() - inv.invoiceDate.getTime()) / 86_400_000));
                    const late = inv.dueDate < now;
                    const ledger = ledgerForInvoice(inv);
                    return (
                      <TR key={inv.id}>
                        <TD>
                          <Link href={invoiceHref(inv)} className="group block">
                            <span className="font-medium text-neutral-900 group-hover:text-brand-600 dark:text-neutral-100 dark:group-hover:text-brand-400">
                              {inv.customerName}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                              {ledger && <span className="h-1.5 w-1.5 rounded-full" style={{ background: LEDGER_COLORS[ledger] }} />}
                              {inv.invoiceNumber}
                            </span>
                          </Link>
                        </TD>
                        <TD>
                          <Badge tone={late ? (days > 60 ? "danger" : "warning") : "neutral"}>
                            {days}d{late ? " · past due" : ""}
                          </Badge>
                        </TD>
                        <TD className="text-right tabular-nums">{formatCurrencyWhole(inv.grossAmount)}</TD>
                        <TD className="text-right font-semibold tabular-nums text-neutral-900 dark:text-white">
                          {formatCurrencyWhole(inv.balance)}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              {open.length > 7 && (
                <p className="border-t border-neutral-100 px-4 py-2.5 text-xs text-neutral-500 dark:border-white/[0.05]">
                  + {open.length - 7} more open invoice{open.length - 7 === 1 ? "" : "s"}
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle title="Recent activity" subtitle="Invoices raised and money received" />
          </CardHeader>
          <CardBody className="py-2">
            {activity.length === 0 ? (
              <div className="py-3">
                <EmptyState icon={FileText} title="No activity yet" />
              </div>
            ) : (
              <ol className="relative">
                {activity.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 py-2.5">
                    {i < activity.length - 1 && (
                      <span className="absolute left-[13px] top-9 bottom-[-6px] w-px bg-neutral-200 dark:bg-white/[0.08]" />
                    )}
                    <span
                      className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-neutral-900 ${
                        a.kind === "payment"
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                      }`}
                    >
                      {a.kind === "payment" ? <HandCoins className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    </span>
                    <Link href={a.href} className="group min-w-0 flex-1">
                      <p className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium text-neutral-900 group-hover:text-brand-600 dark:text-neutral-100 dark:group-hover:text-brand-400">
                          {a.title}
                        </span>
                        <span
                          className={`shrink-0 tabular-nums ${a.kind === "payment" ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300"}`}
                        >
                          {a.kind === "payment" ? "+" : ""}
                          {formatCompactINR(a.amount)}
                        </span>
                      </p>
                      <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {a.subtitle} · {formatDate(a.at)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Money in & out ledger */}
      <Card>
        <CardHeader>
          <CardTitle
            title="Money in & out ledger"
            subtitle={`Receipts through gateways and the business's costs · ${periodLabel}`}
            action={
              <Link
                href={{ pathname: "/expenses", query: venture ? { venture } : {} }}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
        </CardHeader>
        <CardBody>
          {expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nothing logged in this period"
              description="Log money in or money out, tag it with a venture, and it shows up here and in that venture's sheet."
            />
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-emerald-600 dark:text-emerald-400">Money in</p>
                  <dl className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Gross", value: ledgerTotals.inGross, cls: "text-neutral-900 dark:text-white" },
                      { label: "Charges + GST", value: ledgerTotals.inCharges, cls: "text-amber-700 dark:text-amber-400" },
                      { label: "Net", value: ledgerTotals.inNet, cls: "text-emerald-600 dark:text-emerald-400" },
                    ].map((m) => (
                      <div key={m.label} className="rounded-xl bg-neutral-50 p-3 dark:bg-white/[0.03]">
                        <dt className="text-xs text-neutral-500 dark:text-neutral-400">{m.label}</dt>
                        <dd className={`mt-1 text-base font-semibold tabular-nums ${m.cls}`}>{formatCurrencyWhole(m.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-red-600 dark:text-red-400">Money out</p>
                  <dl className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Incl. GST", value: ledgerTotals.outGross, cls: "text-neutral-900 dark:text-white" },
                      { label: "Input GST", value: ledgerTotals.outGst, cls: "text-amber-700 dark:text-amber-400" },
                      { label: "Excl. GST", value: ledgerTotals.outNet, cls: "text-red-600 dark:text-red-400" },
                    ].map((m) => (
                      <div key={m.label} className="rounded-xl bg-neutral-50 p-3 dark:bg-white/[0.03]">
                        <dt className="text-xs text-neutral-500 dark:text-neutral-400">{m.label}</dt>
                        <dd className={`mt-1 text-base font-semibold tabular-nums ${m.cls}`}>{formatCurrencyWhole(m.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
              <div className="space-y-6">
                {costCategories.length > 0 && <DonutBreakdown data={costCategories} centerLabel="Costs" />}
                {inCategories.length > 0 && <DonutBreakdown data={inCategories} centerLabel="Net in" />}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
