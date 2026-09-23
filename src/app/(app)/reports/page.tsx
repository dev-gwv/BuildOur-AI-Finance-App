import Link from "next/link";
import { ArrowRight, Download, FileImage, FileSpreadsheet, FileText, Percent } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope, scopeWhere } from "@/server/scope";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { formatCurrency, formatDate } from "@/lib/format";

const inputClass =
  "h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm shadow-xs outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";

const isPdf = (name: string) => /\.pdf$/i.test(name);

type Proof = {
  key: string;
  file: string;
  date: Date;
  title: string;
  subtitle: string;
  amount: number;
  kind: "IN" | "OUT" | "PAYMENT";
  href?: string;
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; direction?: string }>;
}) {
  const { from, to, direction: directionParam } = await searchParams;
  const direction = directionParam === "IN" || directionParam === "OUT" ? directionParam : null;
  const user = await requirePageUser();
  const scope = await getScope(user);
  const inScope = scopeWhere(scope);

  // Dates are whole days: "to" includes the day itself.
  const range =
    from || to
      ? {
          ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
          ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
        }
      : undefined;

  const [entries, payments] = await Promise.all([
    prisma.expense.findMany({
      where: { ...inScope, screenshotPath: { not: null }, ...(range ? { date: range } : {}), ...(direction ? { direction } : {}) },
      orderBy: { date: "desc" },
      include: { business: { select: { name: true } }, category: { select: { name: true } } },
      take: 60,
    }),
    // Payment screenshots belong with money in; a "money out" filter leaves them out.
    direction === "OUT"
      ? Promise.resolve([])
      : prisma.payment.findMany({
          where: { proofPath: { not: null }, invoice: inScope, ...(range ? { paidOn: range } : {}) },
          orderBy: { paidOn: "desc" },
          include: { invoice: { select: { id: true, invoiceNumber: true, customerName: true, business: { select: { name: true } } } } },
          take: 60,
        }),
  ]);

  const proofs: Proof[] = [
    ...entries.map((e) => ({
      key: `e-${e.id}`,
      file: e.screenshotPath!,
      date: e.date,
      title: e.description || e.category.name,
      subtitle: scope.current ? e.category.name : `${e.business.name} · ${e.category.name}`,
      amount: e.grossAmount,
      kind: e.direction === "OUT" ? ("OUT" as const) : ("IN" as const),
    })),
    ...payments.map((p) => ({
      key: `p-${p.id}`,
      file: p.proofPath!,
      date: p.paidOn,
      title: p.invoice.customerName,
      subtitle: `${scope.current ? "" : `${p.invoice.business.name} · `}${p.invoice.invoiceNumber}${p.method ? ` · ${p.method}` : ""}`,
      amount: p.amount,
      kind: "PAYMENT" as const,
      href: `/invoices/${p.invoice.id}`,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const params = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(direction ? { direction } : {}),
  };
  // The export covers the business being worked in; on "All", everything the user can access.
  const exportUrl = `/api/export?${new URLSearchParams({
    ...params,
    ...(scope.current ? { businessId: scope.current.id } : {}),
  }).toString()}`;
  const href = (d: "IN" | "OUT" | null) => {
    const next: Record<string, string> = { ...params };
    if (d) next.direction = d;
    else delete next.direction;
    return { pathname: "/reports", query: next };
  };
  const hasGst = (scope.current ? [scope.current] : scope.businesses).some((b) => b.entity === "GRATEFUL");
  const filtered = Boolean(from || to || direction);
  const rangeText = from || to ? `${from ? formatDate(from) : "the start"} – ${to ? formatDate(to) : "today"}` : "all dates";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scope.current?.name ?? "All businesses"}
        title="Reports"
        description="Excel workbooks for the accountant, the GST report, and every proof of payment on file."
      />

      <div className={`grid gap-4 ${hasGst ? "lg:grid-cols-2" : ""}`}>
        <Card className="flex flex-col p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Money in &amp; out workbook</h2>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                P&amp;L summary, every entry, invoices with balances, and payments with gateway fees — one sheet each.
              </p>
              <p className="mt-2 text-xs text-neutral-400">
                {scope.current?.name ?? "All businesses"} · {rangeText}
                {direction ? ` · ${direction === "IN" ? "money in only" : "money out only"}` : ""}
              </p>
            </div>
          </div>
          <a
            href={exportUrl}
            className="mt-4 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Download className="h-4 w-4" />
            Download Excel
          </a>
        </Card>

        {hasGst && (
          <Link
            href="/reports/gst"
            className="group flex flex-col rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50 to-white p-5 shadow-card transition-colors hover:border-brand-300 dark:border-brand-500/20 dark:from-brand-500/10 dark:to-transparent"
          >
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                <Percent className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">GST report</h2>
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                  CGST, SGST and IGST by month, split B2B and B2C like GSTR-1, with an input-credit estimate for your CA.
                </p>
              </div>
            </div>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
              Open the GST report
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <Segmented
          items={[
            { key: "all", label: "In & out", href: href(null), active: !direction },
            { key: "IN", label: "Money in", href: href("IN"), active: direction === "IN" },
            { key: "OUT", label: "Money out", href: href("OUT"), active: direction === "OUT" },
          ]}
        />

        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          {direction && <input type="hidden" name="direction" value={direction} />}
          <label className="grid gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            From
            <input type="date" name="from" defaultValue={from ?? ""} className={inputClass} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            To
            <input type="date" name="to" defaultValue={to ?? ""} className={inputClass} />
          </label>
          <button
            type="submit"
            className="h-9 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.08]"
          >
            Apply
          </button>
          {filtered && (
            <Link href="/reports" className="h-9 px-2 text-xs font-medium leading-9 text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Proof of payment</h2>
        <span className="text-xs text-neutral-400">
          {proofs.length} file{proofs.length === 1 ? "" : "s"} · {rangeText}
        </span>
      </div>
      {proofs.length === 0 ? (
        <EmptyState
          icon={FileImage}
          title={filtered ? "No proofs in this selection" : "No proofs uploaded yet"}
          description="Screenshots attached to invoice payments and to money in & out entries collect here."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {proofs.map((p) => (
            <Card key={p.key} className="overflow-hidden">
              <a href={`/api/uploads/${p.file}`} target="_blank" rel="noopener noreferrer" className="block">
                {isPdf(p.file) ? (
                  <div className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-neutral-50 text-neutral-400 dark:bg-white/[0.03]">
                    <FileText className="h-7 w-7" />
                    <span className="text-[11px] font-medium uppercase tracking-wide">PDF</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/${p.file}`}
                    alt={`Proof of payment: ${p.title}`}
                    loading="lazy"
                    className="h-32 w-full bg-neutral-50 object-cover text-[0px] dark:bg-white/[0.03]"
                  />
                )}
              </a>
              <div className="space-y-1 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{p.title}</p>
                  {p.kind === "OUT" ? (
                    <Badge tone="danger">Out</Badge>
                  ) : p.kind === "IN" ? (
                    <Badge tone="success">In</Badge>
                  ) : (
                    <Badge tone="brand">Payment</Badge>
                  )}
                </div>
                <p className="truncate text-neutral-500 dark:text-neutral-400">
                  {p.href ? (
                    <Link href={p.href} className="hover:text-brand-600 dark:hover:text-brand-400">
                      {p.subtitle}
                    </Link>
                  ) : (
                    p.subtitle
                  )}
                </p>
                <p className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                  <span>{formatDate(p.date)}</span>
                  <span
                    className={`font-medium tabular-nums ${p.kind === "OUT" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    {formatCurrency(p.amount)}
                  </span>
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
