import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessCompany } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { ExpenseForm } from "@/components/ExpenseForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionUser();

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) notFound();

  if (!(await canAccessCompany(user, expense.companyId))) {
    notFound();
  }

  const company = await prisma.company.findUnique({
    where: { id: expense.companyId },
    include: {
      gateways: { orderBy: { name: "asc" } },
      categories: { orderBy: { name: "asc" } },
    },
  });
  if (!company) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title="Edit expense" description={company.name} />
      <ExpenseForm
        companies={[company]}
        expense={{
          id: expense.id,
          companyId: expense.companyId,
          categoryId: expense.categoryId,
          gatewayId: expense.gatewayId,
          description: expense.description,
          date: expense.date.toISOString().slice(0, 10),
          grossAmount: expense.grossAmount,
          gstPercent: expense.gstPercent,
          screenshotPath: expense.screenshotPath,
        }}
      />
    </div>
  );
}
