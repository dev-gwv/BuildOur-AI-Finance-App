import Link from "next/link";
import { ArrowRight, Building2, Receipt } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAccessibleCompanyIds } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { InlineCreateForm } from "@/components/InlineCreateForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

export default async function CompaniesPage() {
  const user = await requireSessionUser();
  const isAdmin = user.role === "ADMIN";

  const accessible = await getAccessibleCompanyIds(user);
  const companies = await prisma.company.findMany({
    where: accessible === "ALL" ? {} : { id: { in: accessible } },
    orderBy: { name: "asc" },
    include: { _count: { select: { expenses: true, gateways: true, categories: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Companies" description="Manage the businesses you track expenses and revenue for" />

      {isAdmin && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Add a company</h2>
          </CardHeader>
          <CardBody>
            <InlineCreateForm
              url="/api/companies"
              submitLabel="Add company"
              successMessage="Company added"
              fields={[
                { name: "name", placeholder: "Company name" },
                {
                  name: "defaultGstPercent",
                  type: "number",
                  step: "0.01",
                  placeholder: "GST %",
                  defaultValue: 18,
                },
              ]}
            />
          </CardBody>
        </Card>
      )}

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description={isAdmin ? "Add your first company above to start tracking expenses." : "Ask an admin to grant you access to a company."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
            <Link key={company.id} href={`/companies/${company.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-neutral-300 dark:text-neutral-600" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {company.name}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="indigo">GST {company.defaultGstPercent}%</Badge>
                    <Badge>{company._count.gateways} gateways</Badge>
                    <Badge>{company._count.categories} categories</Badge>
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <Receipt className="h-3.5 w-3.5" />
                    {company._count.expenses} expenses logged
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
