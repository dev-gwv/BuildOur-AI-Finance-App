import { prisma } from "@/lib/prisma";
import { getAccessibleCompanyIds } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { ExpenseForm } from "@/components/ExpenseForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function NewExpensePage() {
  const user = await requireSessionUser();
  const accessible = await getAccessibleCompanyIds(user);

  const companies = await prisma.company.findMany({
    where: accessible === "ALL" ? {} : { id: { in: accessible } },
    orderBy: { name: "asc" },
    include: {
      gateways: { orderBy: { name: "asc" } },
      categories: { orderBy: { name: "asc" } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Add expense" description="Log a payment and see its gateway + GST breakup instantly" />
      <ExpenseForm companies={companies} />
    </div>
  );
}
