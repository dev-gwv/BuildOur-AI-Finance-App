import Link from "next/link";
import { ArrowRight, Download, FileImage, Percent } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope, scopeWhere } from "@/server/scope";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { formatCurrency, formatDate } from "@/lib/format";

const inputClass =
  "h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm shadow-xs dark:border-white/10 dark:bg-neutral-950/60";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; direction?: string }>;
}) {
  const { from, to, direction: directionParam } = await searchParams;
  const direction = directionParam === "IN" || directionParam === "OUT" ? directionParam : null;
  const user = await requirePageUser();
  const scope = await getScope(user);

  const dateFilter =
    from || to
      ? {
          date: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const entries = await prisma.expense.findMany({
    where: { ...scopeWhere(scope), ...dateFilter, ...(direction ? { direction } : {}) },
    orderBy: { date: "desc" },
    include: { business: { select: { name: true, color: true } }, category: { select: { name: true } } },
    take: 100,
  });

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scope.current?.name ?? "All businesses"}
        title="Reports"
        description="Excel exports of money in & out, invoices and payments, and the proof-of-payment screenshots behind them"
        actions={
          <a href={exportUrl}>
            <Button>
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          </a>
        }
      />

      {hasGst && (
      <Link
        href="/reports/gst"
        className="group flex items-center gap-4 rounded-2xl border border-brand-200/70 bg-gradient-to-r from-brand-50 to-white p-5 shadow-card transition-colors hover:border-brand-300 dark:border-brand-500/20 dark:from-brand-500/10 dark:to-transparent"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <Percent className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-neutral-900 dark:text-white">GST report</span>
          <span className="block text-sm text-neutral-500 dark:text-neutral-400">
            CGST / SGST / IGST by month, B2B and B2C, ready for filing
          </span>
        </span>
        <ArrowRight className="h-4 w-4 text-brand-600 transition-transform group-hover:translate-x-0.5 dark:text-brand-400" />
      </Link>
      )}

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Segmented
          items={[
            { key: "all", label: "In & out", href: href(null), active: !direction },
            { key: "IN", label: "Money in", href: href("IN"), active: direction === "IN" },
            { key: "OUT", label: "Money out", href: href("OUT"), active: direction === "OUT" },
          ]}
        />

        <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
          {direction && <input type="hidden" name="direction" value={direction} />}
          <input type="date" name="from" defaultValue={from ?? ""} className={inputClass} />
          <input type="date" name="to" defaultValue={to ?? ""} className={inputClass} />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>

      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Proof of payment</h2>
      {entries.length === 0 ? (
        <EmptyState icon={FileImage} title="Nothing matches these filters" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {entries.map((exp) => (
            <Card key={exp.id} className="overflow-hidden">
              {exp.screenshotPath ? (
                <a href={`/api/uploads/${exp.screenshotPath}`} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/${exp.screenshotPath}`}
                    alt={`Proof of payment for ${exp.description ?? exp.category.name}`}
                    className="h-32 w-full object-cover"
                  />
                </a>
              ) : (
                <div className="flex h-32 w-full items-center justify-center bg-neutral-100 text-neutral-300 dark:bg-neutral-800 dark:text-neutral-600">
                  <FileImage className="h-6 w-6" />
                </div>
              )}
              <div className="space-y-1 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {scope.current ? exp.category.name : `${exp.business.name} · ${exp.category.name}`}
                  </p>
                  {exp.direction === "OUT" ? <Badge tone="danger">Out</Badge> : <Badge tone="success">In</Badge>}
                </div>
                <p className="text-neutral-500 dark:text-neutral-400">{formatDate(exp.date)}</p>
                <p
                  className={`font-medium ${exp.direction === "OUT" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                >
                  {formatCurrency(exp.netAmount)}{" "}
                  <span className="font-normal text-neutral-400">(gross {formatCurrency(exp.grossAmount)})</span>
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
