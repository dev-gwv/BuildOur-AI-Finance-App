import Link from "next/link";
import { Pencil, Plus, Receipt, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAccessibleCompanyIds } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";
import { LEDGERS, LEDGER_KEYS, parseLedger, type LedgerKey } from "@/lib/ventures";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; q?: string; venture?: string; direction?: string }>;
}) {
  const { companyId, q, venture: ventureParam, direction: directionParam } = await searchParams;
  const venture = parseLedger(ventureParam);
  const direction = directionParam === "IN" || directionParam === "OUT" ? directionParam : null;
  const user = await requireSessionUser();
  const accessible = await getAccessibleCompanyIds(user);

  const companies = await prisma.company.findMany({
    where: accessible === "ALL" ? {} : { id: { in: accessible } },
    orderBy: { name: "asc" },
  });

  const companyFilter = companyId
    ? { companyId }
    : accessible === "ALL"
      ? {}
      : { companyId: { in: accessible } };

  const searchFilter = q
    ? {
        OR: [
          { description: { contains: q } },
          { category: { name: { contains: q } } },
        ],
      }
    : {};

  const expenses = await prisma.expense.findMany({
    where: { ...companyFilter, ...searchFilter, ...(venture ? { venture } : {}), ...(direction ? { direction } : {}) },
    orderBy: { date: "desc" },
    include: { company: true, category: true, gateway: true },
    take: 200,
  });

  const href = (overrides: { venture?: LedgerKey | null; companyId?: string | null; direction?: "IN" | "OUT" | null }) => {
    const v = overrides.venture === undefined ? venture : overrides.venture;
    const c = overrides.companyId === undefined ? companyId : overrides.companyId;
    const d = overrides.direction === undefined ? direction : overrides.direction;
    return {
      pathname: "/expenses",
      query: { ...(v ? { venture: v } : {}), ...(c ? { companyId: c } : {}), ...(d ? { direction: d } : {}), ...(q ? { q } : {}) },
    };
  };
  // Money in and money out never share a total: adding a receipt to a cost means nothing.
  const totals = expenses.reduce(
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
        eyebrow="Money"
        title="Money in & out"
        description="Receipts through gateways and the business's own costs, each tagged to the venture whose sheet it belongs in"
        actions={
          <Link
            href="/expenses/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" />
            Add entry
          </Link>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Segmented
            items={[
              { key: "all", label: "All ventures", href: href({ venture: null }), active: !venture },
              ...LEDGER_KEYS.map((key) => ({
                key,
                label: LEDGERS[key].label,
                href: href({ venture: key }),
                active: venture === key,
              })),
            ]}
          />
          <Segmented
            items={[
              { key: "all", label: "In & out", href: href({ direction: null }), active: !direction },
              { key: "IN", label: "Money in", href: href({ direction: "IN" }), active: direction === "IN" },
              { key: "OUT", label: "Money out", href: href({ direction: "OUT" }), active: direction === "OUT" },
            ]}
          />
          {companies.length > 1 && (
            <Segmented
              items={[
                { key: "all", label: "All companies", href: href({ companyId: null }), active: !companyId },
                ...companies.map((c) => ({ key: c.id, label: c.name, href: href({ companyId: c.id }), active: companyId === c.id })),
              ]}
            />
          )}
        </div>

        <form method="get" className="flex items-center gap-2">
          {companyId && <input type="hidden" name="companyId" value={companyId} />}
          {venture && <input type="hidden" name="venture" value={venture} />}
          {direction && <input type="hidden" name="direction" value={direction} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search description or category…"
              className="h-9 w-72 rounded-xl border border-neutral-200/80 bg-white pl-9 pr-3 text-sm shadow-card outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-900/70"
            />
          </div>
        </form>
      </div>

      {expenses.length > 0 && (
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

      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nothing matches"
          description="Try a different filter, or log your first money in or money out."
          action={
            <Link href="/expenses/new">
              <Button size="sm" className="mt-2">
                <Plus className="h-3.5 w-3.5" />
                Add entry
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-neutral-200/80 bg-neutral-50/70 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium text-right">Gross</th>
                <th className="px-4 py-2.5 font-medium">Gateway</th>
                <th className="px-4 py-2.5 font-medium text-right">GST</th>
                <th className="px-4 py-2.5 font-medium text-right">Net</th>
                <th className="px-4 py-2.5 font-medium">Proof</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-white/[0.05]">
              {expenses.map((exp) => (
                <tr key={exp.id} className="transition-colors hover:bg-neutral-50/80 dark:hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {formatDate(exp.date)}
                  </td>
                  <td className="px-4 py-3">
                    {exp.direction === "OUT" ? <Badge tone="danger" dot>Out</Badge> : <Badge tone="success" dot>In</Badge>}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">
                    {exp.company.name}
                    {parseLedger(exp.venture) && (
                      <span className="ml-2">
                        <Badge tone="indigo">{LEDGERS[parseLedger(exp.venture)!].label}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{exp.category.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    {formatCurrency(exp.grossAmount)}
                  </td>
                  <td className="px-4 py-3">
                    {exp.gateway ? (
                      <Badge tone="warning">
                        {exp.gateway.name} −{formatCurrency(exp.gatewayChargeAmount)}
                      </Badge>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    −{formatCurrency(exp.gstAmount)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-semibold ${exp.direction === "OUT" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    {exp.direction === "OUT" ? "−" : ""}
                    {formatCurrency(exp.netAmount)}
                  </td>
                  <td className="px-4 py-3">
                    {exp.screenshotPath ? (
                      <a
                        href={`/api/uploads/${exp.screenshotPath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 hover:underline dark:text-brand-400"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/expenses/${exp.id}/edit`}
                        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        title="Edit expense"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      <DeleteButton url={`/api/expenses/${exp.id}`} label="this expense" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
