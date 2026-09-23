import { notFound } from "next/navigation";
import { CreditCard, Tag } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { canAccessCompany } from "@/lib/access";
import { requireSessionUser } from "@/lib/session";
import { InlineCreateForm } from "@/components/InlineCreateForm";
import { DeleteButton } from "@/components/DeleteButton";
import { GstRateForm } from "@/components/GstRateForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionUser();
  const isAdmin = user.role === "ADMIN";

  if (!(await canAccessCompany(user, id))) {
    notFound();
  }

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      gateways: { orderBy: { name: "asc" } },
      categories: { orderBy: { name: "asc" } },
    },
  });

  if (!company) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description={
          isAdmin ? undefined : `Default GST: ${company.defaultGstPercent}%`
        }
        actions={isAdmin ? <GstRateForm companyId={company.id} defaultGstPercent={company.defaultGstPercent} /> : undefined}
      />

      <Card>
        <CardHeader className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Payment gateways</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {company.gateways.length === 0 ? (
            <EmptyState icon={CreditCard} title="No gateways yet" description="Add Razorpay, PayU, or any processor you use, with its charge %." />
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-white/[0.05]">
              {company.gateways.map((gw) => (
                <li key={gw.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{gw.name}</span>
                  <div className="flex items-center gap-3">
                    <Badge tone="warning">{gw.chargePercent}% charge</Badge>
                    {isAdmin && <DeleteButton url={`/api/gateways/${gw.id}`} label={gw.name} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <InlineCreateForm
              url="/api/gateways"
              extra={{ companyId: company.id }}
              submitLabel="Add gateway"
              successMessage="Gateway added"
              fields={[
                { name: "name", placeholder: "Gateway name (e.g. Razorpay)" },
                { name: "chargePercent", type: "number", step: "0.01", placeholder: "Charge %" },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Expense categories</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {company.categories.length === 0 ? (
            <EmptyState icon={Tag} title="No categories yet" description="Add categories like Guest Fees, Rent, or Salaries to organize expenses." />
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-white/[0.05]">
              {company.categories.map((cat) => (
                <li key={cat.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{cat.name}</span>
                  {isAdmin && <DeleteButton url={`/api/categories/${cat.id}`} label={cat.name} />}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <InlineCreateForm
              url="/api/categories"
              extra={{ companyId: company.id }}
              submitLabel="Add category"
              successMessage="Category added"
              fields={[{ name: "name", placeholder: "Category name (e.g. Guest Fees)" }]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
