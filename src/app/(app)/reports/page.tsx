import { Download, FileImage } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAccessibleCompanyIds } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function ReportsPage({
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
    orderBy: { date: "desc" },
    include: { company: true, category: true },
    take: 100,
  });

  const exportUrl = `/api/export?${new URLSearchParams({
    ...(companyId ? { companyId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Proof-of-payment screenshots and Excel exports"
        actions={
          <a href={exportUrl}>
            <Button>
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          </a>
        }
      />

      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
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
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>

      {expenses.length === 0 ? (
        <EmptyState icon={FileImage} title="No expenses match these filters" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {expenses.map((exp) => (
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
              <div className="p-3 text-xs">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {exp.company.name} · {exp.category.name}
                </p>
                <p className="text-neutral-500 dark:text-neutral-400">{formatDate(exp.date)}</p>
                <p className="mt-1 font-medium text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(exp.netAmount)}{" "}
                  <span className="font-normal text-neutral-400">
                    (gross {formatCurrency(exp.grossAmount)})
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
