import Link from "next/link";
import { ArrowRight, CreditCard, Percent, Receipt, Wallet } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAccessibleCompanyIds } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { MonthlyBarChart, CategoryPieChart } from "@/components/PnlCharts";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatDate } from "@/lib/format";

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; from?: string; to?: string }>;
}) {
  const { companyId, from, to } = await searchParams;
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

  const dateFilter =
    from || to
      ? {
          date: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const expenses = await prisma.expense.findMany({
    where: { ...companyFilter, ...dateFilter },
    include: { category: true, company: true },
    orderBy: { date: "asc" },
  });

  const totals = expenses.reduce(
    (acc, e) => {
      acc.gross += e.grossAmount;
      acc.gatewayCharge += e.gatewayChargeAmount;
      acc.gst += e.gstAmount;
      acc.net += e.netAmount;
      return acc;
    },
    { gross: 0, gatewayCharge: 0, gst: 0, net: 0 }
  );

  const byMonth = new Map<string, { gross: number; gatewayCharge: number; gst: number; net: number }>();
  for (const e of expenses) {
    const key = monthKey(e.date);
    const entry = byMonth.get(key) ?? { gross: 0, gatewayCharge: 0, gst: 0, net: 0 };
    entry.gross += e.grossAmount;
    entry.gatewayCharge += e.gatewayChargeAmount;
    entry.gst += e.gstAmount;
    entry.net += e.netAmount;
    byMonth.set(key, entry);
  }
  const monthlyData = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + e.netAmount);
  }
  const categoryData = Array.from(byCategory.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const topCategory = categoryData[0];

  const avgTransaction = expenses.length > 0 ? totals.gross / expenses.length : 0;
  const recentExpenses = [...expenses].reverse().slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Live P&L across your companies"
        actions={
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <select
              name="companyId"
              defaultValue={companyId ?? ""}
              className="rounded-lg border border-neutral-300 px-2.5 py-1.5 dark:border-neutral-700 dark:bg-neutral-950"
            >
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              className="rounded-lg border border-neutral-300 px-2.5 py-1.5 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              className="rounded-lg border border-neutral-300 px-2.5 py-1.5 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 font-medium text-white shadow-sm hover:bg-indigo-500"
            >
              Filter
            </button>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Gross amount" value={formatCurrency(totals.gross)} icon={Wallet} />
        <StatCard
          label="Gateway charges"
          value={formatCurrency(totals.gatewayCharge)}
          icon={CreditCard}
          tone="warning"
        />
        <StatCard label="GST" value={formatCurrency(totals.gst)} icon={Percent} tone="warning" />
        <StatCard label="Net revenue" value={formatCurrency(totals.net)} icon={Receipt} tone="success" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Transactions"
          value={String(expenses.length)}
          icon={Receipt}
          hint="in this range"
        />
        <StatCard
          label="Avg. transaction"
          value={formatCurrency(avgTransaction)}
          icon={Wallet}
          hint="gross per expense"
        />
        <StatCard
          label="Top category"
          value={topCategory?.name ?? "—"}
          icon={Percent}
          hint={topCategory ? formatCurrency(topCategory.value) + " net" : undefined}
        />
        <StatCard
          label="Companies"
          value={String(companies.length)}
          icon={CreditCard}
          hint="in scope"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Revenue by month
            </h2>
          </CardHeader>
          <CardBody>
            {monthlyData.length > 0 ? (
              <MonthlyBarChart data={monthlyData} />
            ) : (
              <EmptyState icon={Receipt} title="No data yet" description="Add an expense to see monthly trends." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Net revenue by category
            </h2>
          </CardHeader>
          <CardBody>
            {categoryData.length > 0 ? (
              <CategoryPieChart data={categoryData} />
            ) : (
              <EmptyState icon={Percent} title="No data yet" description="Categorized expenses will show up here." />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Recent activity</h2>
          <Link
            href="/expenses"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          {recentExpenses.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Receipt} title="No expenses yet" description="Recent expenses will show up here." />
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {recentExpenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {e.description || e.category.name}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {e.company.name} · {e.category.name} · {formatDate(e.date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="success">{formatCurrency(e.netAmount)} net</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
