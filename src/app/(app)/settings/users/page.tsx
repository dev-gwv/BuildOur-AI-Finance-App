import { redirect } from "next/navigation";
import { Users as UsersIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InlineCreateForm } from "@/components/InlineCreateForm";
import { DeleteButton } from "@/components/DeleteButton";
import { CompanyAccessToggles } from "@/components/CompanyAccessToggles";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { initials } from "@/lib/format";

export default async function UsersSettingsPage() {
  const currentUser = await requireSessionUser();
  if (currentUser.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const [users, companies] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      include: { companies: { select: { companyId: true } } },
    }),
    prisma.company.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Manage who can access which companies" />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Add a user</h2>
        </CardHeader>
        <CardBody>
          <InlineCreateForm
            url="/api/users"
            submitLabel="Create user"
            successMessage="User created"
            fields={[
              { name: "name", placeholder: "Full name" },
              { name: "email", type: "email", placeholder: "Email" },
              { name: "password", type: "password", placeholder: "Password (min 6 chars)" },
            ]}
            extra={{ role: "MEMBER" }}
          />
        </CardBody>
      </Card>

      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id}>
            <CardBody>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                    {initials(u.name)}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {u.name} <span className="font-normal text-neutral-400">· {u.email}</span>
                    </p>
                    <Badge tone={u.role === "ADMIN" ? "indigo" : "neutral"}>{u.role}</Badge>
                  </div>
                </div>
                {u.id !== currentUser.id && (
                  <DeleteButton url={`/api/users/${u.id}`} label={u.name} />
                )}
              </div>
              {u.role === "MEMBER" && (
                <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-white/[0.06]">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <UsersIcon className="h-3.5 w-3.5" />
                    Company access
                  </p>
                  <CompanyAccessToggles
                    userId={u.id}
                    companies={companies}
                    assignedCompanyIds={u.companies.map((c) => c.companyId)}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
