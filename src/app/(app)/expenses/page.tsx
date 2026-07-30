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
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; q?: string }>;
}) {
  const { companyId, q } = await searchParams;
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
    where: { ...companyFilter, ...searchFilter },
    orderBy: { date: "desc" },
    include: { company: true, category: true, gateway: true },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Every payment, with its gateway and GST breakup"
        actions={
          <Link href="/expenses/new">
            <Button>
              <Plus className="h-4 w-4" />
              Add expense
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={{ pathname: "/expenses", query: q ? { q } : {} }}
            className={`rounded-full border px-3 py-1 ${!companyId ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-300" : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}
          >
            All companies
          </Link>
          {companies.map((c) => (
            <Link
              key={c.id}
              href={{ pathname: "/expenses", query: { companyId: c.id, ...(q ? { q } : {}) } }}
              className={`rounded-full border px-3 py-1 ${companyId === c.id ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-300" : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}
            >
              {c.name}
            </Link>
          ))}
        </div>

        <form method="get" className="flex items-center gap-2">
          {companyId && <input type="hidden" name="companyId" value={companyId} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search description or category…"
              className="rounded-lg border border-neutral-300 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>
        </form>
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses match"
          description="Try a different filter, or add your first expense."
          action={
            <Link href="/expenses/new">
              <Button size="sm" className="mt-2">
                <Plus className="h-3.5 w-3.5" />
                Add expense
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Gross</th>
                <th className="px-4 py-3 font-medium">Gateway</th>
                <th className="px-4 py-3 font-medium text-right">GST</th>
                <th className="px-4 py-3 font-medium text-right">Net</th>
                <th className="px-4 py-3 font-medium">Proof</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {expenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {formatDate(exp.date)}
                  </td>
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                    {exp.company.name}
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
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(exp.netAmount)}
                  </td>
                  <td className="px-4 py-3">
                    {exp.screenshotPath ? (
                      <a
                        href={`/api/uploads/${exp.screenshotPath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
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
