import { startOfTodayIST, todayISO } from "@/lib/dates";
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
import { requirePageUser } from "@/server/session";
import { getScope, scopeWhere } from "@/server/scope";
import { CategoryBars, DonutBreakdown, MoneyFlowChart, StackedMonthlyChart, type SeriesDef } from "@/components/DashboardCharts";
import { AlertsBanner } from "@/components/AlertsBanner";
import { startOfToday } from "@/lib/alerts";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatCompactINR, formatCurrencyWhole, formatDate } from "@/lib/format";
import { totalsByPlatform } from "@/lib/invoiceCalc";
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
  // UTC, like the stored dates, so boundaries don't depend on the server's timezone.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function resolvePeriod(period: PeriodKey, from: string | undefined, to: string | undefined, now: Date) {
  // "Now" on the Indian calendar: just after midnight IST on the 1st is the new month.
  const [nowY, nowM] = todayISO(now).split("-").map(Number);
  const monthStart = new Date(Date.UTC(nowY, nowM - 1, 1));
  let current: Range = null;
  switch (period) {
    case "month":
      current = { start: monthStart, end: addMonths(monthStart, 1) };
      break;
    case "lastmonth":
      current = { start: addMonths(monthStart, -1), end: monthStart };
      break;
    case "quarter": {
      const start = addMonths(monthStart, -(((nowM - 1 + 9) % 12) % 3));
      current = { start, end: addMonths(start, 3) };
      break;
    }
    case "fy": {
      const start = new Date(Date.UTC(nowM - 1 >= 3 ? nowY : nowY - 1, 3, 1));
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
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------

function greeting(now: Date) {
  // Server time is UTC; the business runs on IST.
  const hour = (now.getUTCHours() + 5.5) % 24;
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; period?: string }>;
}) {
  const params = await searchParams;
  const { from, to } = params;
  const period: PeriodKey =
    from || to ? "custom" : (PERIODS.find((p) => p.key === params.period)?.key ?? "fy");

  const user = await requirePageUser();
  const scope = await getScope(user);
  const now = new Date();
  const { current, previous } = resolvePeriod(period, from, to, now);

  // Everything below is limited to the business picked in the switcher, or to
  // every business the user can access when "All businesses" is selected.
  const inScope = scopeWhere(scope);
  const invoiceWhere: Prisma.InvoiceWhereInput = inScope;
  const entryWhere: Prisma.ExpenseWhereInput = inScope;
  const businessById = new Map(scope.businesses.map((b) => [b.id, b]));
  const colorOf = (businessId: string) => businessById.get(businessId)?.color ?? "#a3a3a3";
  const showBusinesses = !scope.current && scope.businesses.length > 1;

  // The chart always shows at least six months so a single-month period still has context.
  const chartEnd = current?.end ?? addMonths(startOfTodayIST(now), 1);
  const chartStart = current && current.start < addMonths(chartEnd, -6) ? current.start : addMonths(chartEnd, -6);
  const chartFrom = period === "all" ? undefined : chartStart;

  // A business with nothing in it yet gets a guided start, not seven empty cards.
  const [invoiceCount, entryCount] = await Promise.all([
    prisma.invoice.count({ where: invoiceWhere }),
    prisma.expense.count({ where: entryWhere }),
  ]);
  if (invoiceCount === 0 && entryCount === 0) {
    const isAdmin = user.role === "ADMIN";
    const scopeName = scope.current?.name ?? "All businesses";
    const steps = [
      {
        icon: FileText,
        title: "Raise the first invoice",
        body: scope.current?.entity === "MULBERRY"
          ? "Upload a package quotation — the client, events and total fill in by themselves."
          : "Upload a Bajaj delivery order or a customer's GST certificate — PDF, photo or screenshot.",
        href: "/invoices/new",
        cta: "New invoice",
      },
      {
        icon: Receipt,
        title: "Log money in and out",
        body: "Receipts through gateways and the business's costs, with GST and charges worked out for you.",
        href: "/money/new",
        cta: "Add an entry",
      },
      ...(isAdmin
        ? [
            {
              icon: Wallet,
              title: "Connect its Google Sheet",
              body: "Every payment and entry is then written into the sheet as it's saved.",
              href: scope.current ? `/settings/businesses/${scope.current.id}` : "/settings/businesses",
              cta: "Set up the sheet",
            },
          ]
        : []),
    ];
    return (
      <div className="space-y-6">
        <AlertsBanner
          scope={scope.current ? [scope.current.id] : scope.access === "ALL" ? "ALL" : scope.businesses.map((b) => b.id)}
          isAdmin={isAdmin}
        />
        <PageHeader
          eyebrow={`${greeting(now)}, ${user.name.split(" ")[0]}`}
          title={
            <span className="flex items-center gap-2.5">
              {scope.current && <span className="h-2.5 w-2.5 rounded-full" style={{ background: scope.current.color }} />}
              Overview · {scopeName}
            </span>
          }
          description="Nothing has been recorded here yet. Start with any of these — the overview fills in as you go."
        />
        <div className={`grid gap-4 ${steps.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          {steps.map((s, i) => (
            <Card key={s.title} className="flex flex-col p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <s.icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">Step {i + 1}</span>
              </div>
              <h2 className="mt-4 text-base font-semibold text-neutral-900 dark:text-white">{s.title}</h2>
              <p className="mt-1 flex-1 text-sm text-neutral-500 dark:text-neutral-400">{s.body}</p>
              <Link
                href={s.href}
                className="mt-5 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {s.cta} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const expenseSums = { grossAmount: true, gatewayChargeAmount: true } as const;
  const paymentSums = { amount: true, feeAmount: true, feeGstAmount: true } as const;

  const [
    invoicedNow,
    invoicedByBusiness,
    paymentsNow,
    paymentsPrev,
    openInvoices,
    chartPayments,
    chartLedger,
    expenses,
    ledgerPrev,
    ledgerByBusiness,
    recentInvoices,
    recentPayments,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...invoiceWhere, invoiceDate: within(current) },
      _sum: { grossAmount: true },
      _count: true,
    }),
    showBusinesses
      ? prisma.invoice.groupBy({
          by: ["businessId"],
          where: { ...invoiceWhere, invoiceDate: within(current) },
          _sum: { grossAmount: true },
          _count: true,
        })
      : null,
    prisma.payment.findMany({
      where: { invoice: invoiceWhere, paidOn: within(current) },
      select: { amount: true, method: true, feeAmount: true, feeGstAmount: true, invoice: { select: { businessId: true } } },
    }),
    previous
      ? prisma.payment.aggregate({ where: { invoice: invoiceWhere, paidOn: within(previous) }, _sum: paymentSums })
      : null,
    // Dues are a balance, not a flow: every invoice ever raised that isn't settled.
    prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        businessId: true,
        invoiceNumber: true,
        customerName: true,
        invoiceDate: true,
        dueDate: true,
        grossAmount: true,
        saleType: true,
        financedAmount: true,
        payments: { select: { amount: true, method: true } },
      },
    }),
    prisma.payment.findMany({
      where: { invoice: invoiceWhere, ...(chartFrom ? { paidOn: { gte: chartFrom, lt: chartEnd } } : {}) },
      select: {
        amount: true,
        feeAmount: true,
        feeGstAmount: true,
        paidOn: true,
        invoice: { select: { businessId: true } },
      },
    }),
    prisma.expense.findMany({
      where: { ...entryWhere, ...(chartFrom ? { date: { gte: chartFrom, lt: chartEnd } } : {}) },
      select: { date: true, direction: true, grossAmount: true, gatewayChargeAmount: true },
    }),
    prisma.expense.findMany({
      where: { ...entryWhere, date: within(current) },
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
          where: { ...entryWhere, date: within(previous) },
          _sum: expenseSums,
        })
      : null,
    showBusinesses
      ? prisma.expense.groupBy({
          by: ["businessId", "direction"],
          where: { ...entryWhere, date: within(current) },
          _sum: expenseSums,
        })
      : null,
    prisma.invoice.findMany({
      where: invoiceWhere,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, businessId: true, invoiceNumber: true, customerName: true, grossAmount: true, invoiceDate: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: { invoice: invoiceWhere },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        amount: true,
        method: true,
        paidOn: true,
        createdAt: true,
        invoice: { select: { id: true, businessId: true, customerName: true, invoiceNumber: true } },
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
      const balance = Math.round((inv.grossAmount - paid) * 100) / 100;
      // A Bajaj sale Bajaj hasn't paid out on is waiting on Bajaj, not on the customer.
      const awaiting = inv.saleType === "BAJAJ" && !inv.payments.some((p) => p.method === "Bajaj Finance disbursement");
      return { ...inv, balance, awaiting };
    })
    .filter((inv) => inv.balance > 0.5)
    .sort((a, b) => b.balance - a.balance);
  const outstandingTotal = open.reduce((s, i) => s + i.balance, 0);
  const today = startOfToday(now);
  const overdue = open.filter((i) => !i.awaiting && i.dueDate < today);
  const awaitingBajaj = open.filter((i) => i.awaiting);
  // Bajaj owes only the financed part; any unpaid down payment is the customer's.
  const awaitingBajajTotal = awaitingBajaj.reduce((s, i) => s + Math.min(i.financedAmount ?? i.balance, i.balance), 0);

  // --- Collections by month, stacked per business; and money in vs out ---
  const seriesKeys: string[] = scope.current ? [scope.current.id] : scope.businesses.map((b) => b.id);
  const buckets = new Map<string, Record<string, number>>();
  const flows = new Map<string, { in: number; out: number; fees: number }>();
  for (let d = new Date(chartStart); d < chartEnd; d = addMonths(d, 1)) buckets.set(monthKey(d), {});
  for (const p of chartPayments) {
    const key = monthKey(p.paidOn);
    const bucket = buckets.get(key) ?? {};
    bucket[p.invoice.businessId] = (bucket[p.invoice.businessId] ?? 0) + p.amount;
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
  const windowProfit = flowData.reduce((sum, f) => sum + f.profit, 0);
  const usedSeries = seriesKeys.filter((s) => chartData.some((row) => ((row as Record<string, number | string>)[s] as number) > 0));
  const series: SeriesDef[] = (usedSeries.length ? usedSeries : seriesKeys).map((key) => ({
    key,
    label: businessById.get(key)?.name ?? "Business",
    color: colorOf(key),
  }));
  const receivedTrend = chartData.map((row) => seriesKeys.reduce((s, k) => s + Number((row as Record<string, number | string>)[k] ?? 0), 0));
  const profitTrend = flowData.map((f) => f.profit);

  // --- Per-business breakdown (the "All businesses" view) ---
  const perBusiness = showBusinesses
    ? scope.businesses.map((b) => {
        const inv = invoicedByBusiness?.find((g) => g.businessId === b.id);
        const pays = paymentsNow.filter((p) => p.invoice.businessId === b.id);
        const received = pays.reduce((s, p) => s + p.amount, 0);
        const fees = pays.reduce((s, p) => s + p.feeAmount + p.feeGstAmount, 0);
        const lIn = ledgerByBusiness?.find((g) => g.businessId === b.id && g.direction !== "OUT")?._sum;
        const lOut = ledgerByBusiness?.find((g) => g.businessId === b.id && g.direction === "OUT")?._sum.grossAmount ?? 0;
        return {
          business: b,
          invoices: inv?._count ?? 0,
          invoiced: inv?._sum.grossAmount ?? 0,
          received,
          outstanding: open.filter((o) => o.businessId === b.id).reduce((sum, o) => sum + o.balance, 0),
          moneyOut: lOut,
          profit: received - fees + (lIn?.grossAmount ?? 0) - (lIn?.gatewayChargeAmount ?? 0) - lOut,
        };
      })
    : [];

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
      shownAt: i.invoiceDate,
      kind: "invoice" as const,
      title: `${i.invoiceNumber} raised`,
      subtitle: i.customerName,
      amount: i.grossAmount,
      href: `/invoices/${i.id}`,
      businessId: i.businessId,
    })),
    ...recentPayments.map((p) => ({
      id: `p-${p.id}`,
      at: p.createdAt,
      shownAt: p.paidOn,
      kind: "payment" as const,
      title: `Received${p.method ? ` via ${p.method}` : ""}`,
      subtitle: `${p.invoice.customerName} · ${p.invoice.invoiceNumber}`,
      amount: p.amount,
      href: `/invoices/${p.invoice.id}`,
      businessId: p.invoice.businessId,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);

  // --- URL helpers: the period controls keep each other's state ---
  const query = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      period: period === "custom" ? undefined : period,
      from,
      to,
      ...overrides,
    };
    return Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>;
  };
  const PERIOD_PHRASE: Record<string, string> = {
    month: "this month",
    lastmonth: "last month",
    quarter: "this quarter",
    fy: "this FY",
    "12m": "the last 12 months",
    all: "all time",
  };
  const periodLabel =
    period === "custom"
      ? `${from ? formatDate(from) : "the start"} – ${to ? formatDate(to) : "today"}`
      : PERIOD_PHRASE[period];
  // The charts span at least six months, which can be longer than the period.
  const windowLabel = monthKeys.length ? `${monthLabel(monthKeys[0])} – ${monthLabel(monthKeys[monthKeys.length - 1])}` : "";
  const scopeName = scope.current?.name ?? "All businesses";
  const alertScope = scope.current ? [scope.current.id] : scope.access === "ALL" ? "ALL" : scope.businesses.map((b) => b.id);

  return (
    <div className="space-y-6">
      <AlertsBanner scope={alertScope} isAdmin={user.role === "ADMIN"} />

      <PageHeader
        eyebrow={`${greeting(now)}, ${user.name.split(" ")[0]} · ${now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}`}
        title={
          <span className="flex items-center gap-2.5">
            {scope.current && <span className="h-2.5 w-2.5 rounded-full" style={{ background: scope.current.color }} />}
            Overview · {scopeName}
          </span>
        }
        description={`Collections, dues, costs and profit, ${periodLabel}.${
          scope.current ? "" : " Switch business in the sidebar to focus on one."
        }`}
        actions={
          <Link
            href="/invoices/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-4 w-4" />
            New invoice
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
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
                period === "custom"
                  ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                  : "border-neutral-200/80 bg-white text-neutral-600 dark:border-white/[0.07] dark:bg-neutral-900/70 dark:text-neutral-300"
              }`}
            >
              Custom dates
            </summary>
            <form
              method="get"
              className="absolute right-0 z-10 mt-2 grid w-72 gap-3 rounded-xl border border-neutral-200/80 bg-white p-4 text-sm shadow-pop dark:border-white/10 dark:bg-neutral-900"
            >
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
                <Link href="/dashboard" className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
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
          hint={
            open.length
              ? `${open.length} open · ${overdue.length} past due${
                  awaitingBajaj.length ? ` · ${formatCompactINR(awaitingBajajTotal)} awaiting Bajaj (${awaitingBajaj.length})` : ""
                }`
              : "Nothing owed right now"
          }
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
              subtitle={`${scope.current ? `Money received into ${scope.current.name}` : "Money received, split by business"} · ${windowLabel}`}
              action={
                <span className="block text-right">
                  <span className="block text-lg font-semibold leading-tight tabular-nums text-neutral-900 dark:text-white">
                    {formatCompactINR(receivedTrend.reduce((s, v) => s + v, 0))}
                  </span>
                  <span className="text-[11px] text-neutral-400">in this window</span>
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
            subtitle={`Money in after gateway fees (invoice collections + ledger receipts) against money out · ${windowLabel}`}
            action={
              <span className="block text-right">
                <span
                  className={`block text-lg font-semibold leading-tight tabular-nums ${windowProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                >
                  {formatCompactINR(windowProfit)}
                </span>
                <span className="text-[11px] text-neutral-400">profit in this window</span>
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
      {showBusinesses && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle title="By business" subtitle={`Each row matches its Google Sheet · ${periodLabel}`} />
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="min-w-[980px]">
              <THead>
                <tr>
                  <TH>Business</TH>
                  <TH className="whitespace-nowrap text-right">Invoiced</TH>
                  <TH className="whitespace-nowrap text-right">Collected</TH>
                  <TH className="whitespace-nowrap text-right">Outstanding</TH>
                  <TH className="whitespace-nowrap text-right">Money out</TH>
                  <TH className="whitespace-nowrap text-right">Profit</TH>
                  <TH className="w-40 whitespace-nowrap">Collection rate</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {perBusiness.map((row) => {
                  const rate = row.invoiced > 0 ? Math.min(100, (row.received / row.invoiced) * 100) : null;
                  return (
                    <TR key={row.business.id}>
                      <TD>
                        <span className="flex items-center gap-2 whitespace-nowrap font-medium text-neutral-900 dark:text-neutral-100">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.business.color }} />
                          {row.business.name}
                          <span className="text-xs font-normal text-neutral-400">{row.invoices} inv.</span>
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{formatCurrencyWhole(row.invoiced)}</TD>
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
                              <div className="h-full rounded-full" style={{ width: `${rate}%`, background: row.business.color }} />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums">{Math.round(rate)}%</span>
                          </div>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Link
                          href={`/scope?b=${row.business.slug}&next=${encodeURIComponent("/dashboard")}`}
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
      <div className="grid items-start gap-4 xl:grid-cols-5">
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
              {openInvoices.length === 0 ? (
                <EmptyState icon={CircleDollarSign} title="No invoices yet" description="Balances owed on invoices show up here." />
              ) : (
                <EmptyState icon={CircleDollarSign} title="All settled" description="Every invoice here has been paid in full." />
              )}
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
                    const late = !inv.awaiting && inv.dueDate < today;
                    return (
                      <TR key={inv.id}>
                        <TD>
                          <Link href={`/invoices/${inv.id}`} className="group block">
                            <span className="font-medium text-neutral-900 group-hover:text-brand-600 dark:text-neutral-100 dark:group-hover:text-brand-400">
                              {inv.customerName}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                              {showBusinesses && (
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(inv.businessId) }} />
                              )}
                              {inv.invoiceNumber}
                            </span>
                          </Link>
                        </TD>
                        <TD>
                          {inv.awaiting ? (
                            <Badge tone="brand">{days}d · awaiting Bajaj</Badge>
                          ) : (
                            <Badge tone={late ? (days > 60 ? "danger" : "warning") : "neutral"}>
                              {days}d{late ? " · past due" : ""}
                            </Badge>
                          )}
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
                        {a.subtitle} · {formatDate(a.shownAt)}
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
                href="/money"
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
              description="Log money in or money out and it shows up here and in its business's Google Sheet."
            />
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-5">
                {[
                  {
                    title: "Money in",
                    titleCls: "text-emerald-600 dark:text-emerald-400",
                    count: ledgerIn.length,
                    empty: "No receipts logged in this period.",
                    tiles: [
                      { label: "Gross", value: ledgerTotals.inGross, cls: "text-neutral-900 dark:text-white" },
                      { label: "Charges + GST", value: ledgerTotals.inCharges, cls: "text-amber-700 dark:text-amber-400" },
                      { label: "Net", value: ledgerTotals.inNet, cls: "text-emerald-600 dark:text-emerald-400" },
                    ],
                  },
                  {
                    title: "Money out",
                    titleCls: "text-red-600 dark:text-red-400",
                    count: ledgerOut.length,
                    empty: "No costs logged in this period.",
                    tiles: [
                      { label: "Incl. GST", value: ledgerTotals.outGross, cls: "text-neutral-900 dark:text-white" },
                      { label: "Input GST", value: ledgerTotals.outGst, cls: "text-amber-700 dark:text-amber-400" },
                      { label: "Excl. GST", value: ledgerTotals.outNet, cls: "text-neutral-900 dark:text-white" },
                    ],
                  },
                ].map((side) => (
                  <div key={side.title}>
                    <p className={`mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.06em] ${side.titleCls}`}>
                      {side.title}
                      <span className="font-normal normal-case tracking-normal text-neutral-400">
                        {side.count} entr{side.count === 1 ? "y" : "ies"}
                      </span>
                    </p>
                    {side.count === 0 ? (
                      <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-sm text-neutral-500 dark:border-white/10 dark:text-neutral-400">
                        {side.empty}
                      </p>
                    ) : (
                      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {side.tiles.map((m) => (
                          <div key={m.label} className="rounded-xl bg-neutral-50 p-3 dark:bg-white/[0.03]">
                            <dt className="text-xs text-neutral-500 dark:text-neutral-400">{m.label}</dt>
                            <dd className={`mt-1 text-base font-semibold tabular-nums ${m.cls}`}>{formatCurrencyWhole(m.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-6">
                {costCategories.length > 0 && <CategoryBars title="Costs by category" data={costCategories} color="#f43f5e" />}
                {inCategories.length > 0 && <CategoryBars title="Money in by category (net)" data={inCategories} color="#10b981" />}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
