import Link from "next/link";
import { HandCoins, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope, scopeWhere } from "@/server/scope";
import { LIST_PERIODS, parseListPeriod, periodFilter } from "@/components/invoices/listPeriods";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";

const GATEWAYS = [
  { key: "all", label: "All" },
  { key: "razorpay", label: "Razorpay" },
  { key: "direct", label: "Direct" },
] as const;
type GatewayKey = (typeof GATEWAYS)[number]["key"];

/**
 * Every payment received, across the invoices in scope. Read-only: payments
 * are recorded and edited on their invoice, where the balance they settle is.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; gateway?: string; method?: string; q?: string }>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const period = parseListPeriod(params.period);
  const gateway: GatewayKey = GATEWAYS.some((g) => g.key === params.gateway) ? (params.gateway as GatewayKey) : "all";
  const method = (params.method ?? "").trim().slice(0, 60);
  const q = (params.q ?? "").trim().slice(0, 100);

  const scope = await getScope(user);
  const dates = periodFilter(period);
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...scopeWhere(scope),
    ...(q
      ? {
          OR: [
            { customerName: { contains: q, mode: "insensitive" } },
            { invoiceNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const where: Prisma.PaymentWhereInput = {
    invoice: invoiceWhere,
    ...(dates ? { paidOn: dates } : {}),
    ...(gateway === "razorpay" ? { gateway: "Razorpay" } : gateway === "direct" ? { gateway: null } : {}),
    ...(method ? { method } : {}),
  };

  const [payments, methods] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        amount: true,
        paidOn: true,
        method: true,
        gateway: true,
        gatewayRef: true,
        feeAmount: true,
        feeGstAmount: true,
        note: true,
        invoice: {
          select: { id: true, invoiceNumber: true, customerName: true, business: { select: { name: true, color: true } } },
        },
      },
    }),
    prisma.payment.findMany({
      where: { invoice: scopeWhere(scope), method: { not: null } },
      distinct: ["method"],
      select: { method: true },
      orderBy: { method: "asc" },
    }),
  ]);

  const totals = payments.reduce(
    (acc, p) => {
      const fees = p.feeAmount + p.feeGstAmount;
      return { received: acc.received + p.amount, fees: acc.fees + fees, net: acc.net + p.amount - fees };
    },
    { received: 0, fees: 0, net: 0 }
  );

  const current = { period, gateway, method, q };
  const href = (over: Partial<typeof current>) => {
    const f = { ...current, ...over };
    return {
      pathname: "/payments",
      query: {
        ...(f.period !== "all" ? { period: f.period } : {}),
        ...(f.gateway !== "all" ? { gateway: f.gateway } : {}),
        ...(f.method ? { method: f.method } : {}),
        ...(f.q ? { q: f.q } : {}),
      },
    };
  };
  const showBusiness = !scope.current;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payments"
        title={scope.current?.name ?? "All businesses"}
        description="Every payment received against an invoice. To record or change one, open its invoice."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Received", value: totals.received, hint: `${payments.length} payment${payments.length === 1 ? "" : "s"}`, cls: "text-neutral-950 dark:text-white" },
          { label: "Gateway fees", value: totals.fees, hint: "commission + GST on it", cls: totals.fees > 0 ? "text-amber-700 dark:text-amber-400" : "text-neutral-950 dark:text-white" },
          { label: "Landed in the bank", value: totals.net, hint: "received − fees", cls: "text-emerald-600 dark:text-emerald-400" },
        ].map((m) => (
          <Card key={m.label} className="px-5 py-4">
            <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{m.label}</p>
            <p className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums ${m.cls}`}>{formatCurrencyWhole(m.value)}</p>
            <p className="mt-0.5 text-xs text-neutral-400">{m.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-neutral-100 px-4 py-3 xl:flex-row xl:items-center xl:justify-between dark:border-white/[0.06]">
          <div className="flex flex-wrap gap-2">
            <Segmented items={LIST_PERIODS.map((p) => ({ key: p.key, label: p.label, href: href({ period: p.key }), active: period === p.key }))} />
            <Segmented items={GATEWAYS.map((g) => ({ key: g.key, label: g.label, href: href({ gateway: g.key }), active: gateway === g.key }))} />
          </div>
          <form method="get" action="/payments" className="flex flex-wrap items-center gap-2">
            {period !== "all" && <input type="hidden" name="period" value={period} />}
            {gateway !== "all" && <input type="hidden" name="gateway" value={gateway} />}
            <select
              name="method"
              defaultValue={method}
              className="h-9 rounded-xl border border-neutral-200/80 bg-white px-3 text-sm shadow-card dark:border-white/10 dark:bg-neutral-900/70"
            >
              <option value="">Any method</option>
              {methods.map((m) => (
                <option key={m.method} value={m.method ?? ""}>
                  {m.method}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Customer or invoice no.…"
                className="h-9 w-64 rounded-xl border border-neutral-200/80 bg-white pl-9 pr-3 text-sm shadow-card outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-900/70"
              />
            </div>
            <button className="h-9 rounded-xl bg-neutral-900 px-3 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
              Apply
            </button>
          </form>
        </div>

        {payments.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={HandCoins}
              title="No payments match"
              description="Payments recorded on invoices show up here. Try a different period or filter."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH>Invoice</TH>
                  {showBusiness && <TH>Business</TH>}
                  <TH>Method</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Fees</TH>
                  <TH className="text-right">Net received</TH>
                </tr>
              </THead>
              <TBody>
                {payments.map((p) => {
                  const fees = p.feeAmount + p.feeGstAmount;
                  return (
                    <TR key={p.id}>
                      <TD className="whitespace-nowrap">{formatDate(p.paidOn)}</TD>
                      <TD className="font-medium text-neutral-800 dark:text-neutral-200">{p.invoice.customerName}</TD>
                      <TD>
                        <Link
                          href={`/invoices/${p.invoice.id}`}
                          className="font-medium text-neutral-900 hover:text-brand-600 dark:text-neutral-100 dark:hover:text-brand-400"
                        >
                          {p.invoice.invoiceNumber}
                        </Link>
                      </TD>
                      {showBusiness && (
                        <TD>
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.invoice.business.color }} />
                            {p.invoice.business.name}
                          </span>
                        </TD>
                      )}
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          <span>{p.method ?? "—"}</span>
                          {p.gateway && p.gateway !== p.method && <Badge tone="brand">{p.gateway}</Badge>}
                        </div>
                        {p.gatewayRef && <p className="font-mono text-[11px] text-neutral-400">{p.gatewayRef}</p>}
                      </TD>
                      <TD className="text-right tabular-nums font-medium text-neutral-900 dark:text-neutral-100">{formatCurrency(p.amount)}</TD>
                      <TD className={`text-right tabular-nums ${fees > 0 ? "text-amber-700 dark:text-amber-400" : "text-neutral-300 dark:text-neutral-600"}`}>
                        {fees > 0 ? `−${formatCurrency(fees)}` : "—"}
                      </TD>
                      <TD className="text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(p.amount - fees)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
