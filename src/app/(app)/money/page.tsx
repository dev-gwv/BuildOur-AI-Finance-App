import Link from "next/link";
import { Pencil, Plus, Receipt, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope, scopeWhere } from "@/server/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatCurrency, formatDate } from "@/lib/format";

const newButtonClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900";

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; direction?: string }>;
}) {
  const { q, direction: directionParam } = await searchParams;
  const direction = directionParam === "IN" || directionParam === "OUT" ? directionParam : null;
  const user = await requirePageUser();
  const scope = await getScope(user);
  const showBusiness = !scope.current;

  const entries = await prisma.expense.findMany({
    where: {
      ...scopeWhere(scope),
      ...(direction ? { direction } : {}),
      ...(q
        ? {
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { category: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { date: "desc" },
    include: {
      business: { select: { name: true, color: true } },
      category: { select: { name: true } },
      gateway: { select: { name: true } },
    },
    take: 300,
  });

  const href = (d: "IN" | "OUT" | null) => ({
    pathname: "/money",
    query: { ...(d ? { direction: d } : {}), ...(q ? { q } : {}) },
  });

  // Money in and money out never share a total: adding a receipt to a cost means nothing.
  const totals = entries.reduce(
    (acc, e) =>
      e.direction === "OUT"
        ? { ...acc, outGross: acc.outGross + e.grossAmount, outNet: acc.outNet + e.netAmount, outCount: acc.outCount + 1 }
        : {
            ...acc,
            inGross: acc.inGross + e.grossAmount,
            inCharges: acc.inCharges + e.gatewayChargeAmount + e.gstAmount,
            inNet: acc.inNet + e.netAmount,
            inCount: acc.inCount + 1,
          },
    { inGross: 0, inCharges: 0, inNet: 0, inCount: 0, outGross: 0, outNet: 0, outCount: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scope.current?.name ?? "All businesses"}
        title="Money in & out"
        description="Receipts through gateways and the business's own costs, outside invoices. Each entry is also written to its business's Google Sheet."
        actions={
          <Link href="/money/new" className={newButtonClass}>
            <Plus className="h-4 w-4" />
            Add entry
          </Link>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          items={[
            { key: "all", label: "In & out", href: href(null), active: !direction },
            { key: "IN", label: "Money in", href: href("IN"), active: direction === "IN" },
            { key: "OUT", label: "Money out", href: href("OUT"), active: direction === "OUT" },
          ]}
        />
        <form method="get" className="flex items-center gap-2">
          {direction && <input type="hidden" name="direction" value={direction} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search description or category…"
              className="h-9 w-full rounded-xl border border-neutral-200/80 bg-white pl-9 pr-3 text-sm shadow-card outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 sm:w-72 dark:border-white/10 dark:bg-neutral-900/70"
            />
          </div>
        </form>
      </div>

      {entries.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Money in · gross", value: totals.inGross, hint: `${totals.inCount} receipt${totals.inCount === 1 ? "" : "s"}`, cls: "text-neutral-950 dark:text-white" },
            { label: "Money in · net", value: totals.inNet, hint: `after ${formatCurrency(totals.inCharges)} charges + GST`, cls: "text-emerald-600 dark:text-emerald-400" },
            { label: "Money out · incl. GST", value: totals.outGross, hint: `${totals.outCount} cost${totals.outCount === 1 ? "" : "s"}`, cls: "text-red-600 dark:text-red-400" },
            { label: "Money out · excl. GST", value: totals.outNet, hint: `${formatCurrency(totals.outGross - totals.outNet)} input GST`, cls: "text-neutral-950 dark:text-white" },
          ].map((m) => (
            <Card key={m.label} className="px-5 py-4">
              <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{m.label}</p>
              <p className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums ${m.cls}`}>{formatCurrency(m.value)}</p>
              <p className="mt-0.5 truncate text-xs text-neutral-400">{m.hint}</p>
            </Card>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={q || direction ? "Nothing matches" : "No entries yet"}
          description={q || direction ? "Try a different filter." : "Log money that came in through a gateway, or a cost the business paid."}
          action={
            <Link href="/money/new" className={`${newButtonClass} mt-2 h-8 px-3 text-xs`}>
              <Plus className="h-3.5 w-3.5" />
              Add entry
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  {showBusiness && <TH>Business</TH>}
                  <TH>Category</TH>
                  <TH className="text-right">Gross</TH>
                  <TH>Gateway</TH>
                  <TH className="text-right">GST</TH>
                  <TH className="text-right">Net</TH>
                  <TH>Proof</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {entries.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">{formatDate(e.date)}</TD>
                    <TD>{e.direction === "OUT" ? <Badge tone="danger" dot>Out</Badge> : <Badge tone="success" dot>In</Badge>}</TD>
                    {showBusiness && (
                      <TD>
                        <span className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.business.color }} />
                          {e.business.name}
                        </span>
                      </TD>
                    )}
                    <TD>
                      <p className="text-neutral-800 dark:text-neutral-200">{e.category.name}</p>
                      {e.description && <p className="max-w-56 truncate text-xs text-neutral-400">{e.description}</p>}
                    </TD>
                    <TD className="text-right tabular-nums">{formatCurrency(e.grossAmount)}</TD>
                    <TD>
                      {e.gateway ? (
                        <Badge tone="warning">
                          {e.gateway.name} −{formatCurrency(e.gatewayChargeAmount)}
                        </Badge>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">−{formatCurrency(e.gstAmount)}</TD>
                    <TD
                      className={`text-right tabular-nums font-semibold ${e.direction === "OUT" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                    >
                      {e.direction === "OUT" ? "−" : ""}
                      {formatCurrency(e.netAmount)}
                    </TD>
                    <TD>
                      {e.screenshotPath ? (
                        <a
                          href={`/api/uploads/${e.screenshotPath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-600 hover:underline dark:text-brand-400"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/money/${e.id}/edit`}
                          className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                          title="Edit entry"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                        <DeleteButton url={`/api/entries/${e.id}`} label="this entry" />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {entries.length === 300 && (
            <p className="border-t border-neutral-100 px-4 py-2.5 text-xs text-neutral-500 dark:border-white/[0.05]">
              Showing the latest 300 — search or filter to narrow down, or export from Reports for the full list.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
