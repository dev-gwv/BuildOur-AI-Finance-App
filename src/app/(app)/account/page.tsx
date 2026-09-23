import { KeyRound, UserRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { initials } from "@/lib/format";

export default async function AccountPage() {
  const session = await requirePageUser();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      name: true,
      email: true,
      role: true,
      lastLoginAt: true,
      createdAt: true,
      businesses: { select: { business: { select: { name: true, color: true } } } },
    },
  });
  if (!user) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow="Account" title="Your account" description="Your sign-in details and password." />

      <Card>
        <CardHeader>
          <CardTitle
            title={
              <span className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-neutral-400" />
                Profile
              </span>
            }
            subtitle="Ask an admin to change your name, email or role"
          />
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 text-sm font-semibold text-white">
              {initials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-neutral-950 dark:text-white">{user.name}</p>
              <p className="text-sm text-neutral-500">{user.email}</p>
            </div>
          </div>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-neutral-500">Role</dt>
              <dd className="mt-1">
                <Badge tone={user.role === "ADMIN" ? "brand" : "neutral"}>{user.role === "ADMIN" ? "Admin" : "Member"}</Badge>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-neutral-500">Businesses</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {user.role === "ADMIN" ? (
                  <span className="text-neutral-700 dark:text-neutral-300">All businesses</span>
                ) : user.businesses.length === 0 ? (
                  <span className="text-neutral-500">None yet — ask an admin for access</span>
                ) : (
                  user.businesses.map(({ business }) => (
                    <span
                      key={business.name}
                      className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-white/[0.06] dark:text-neutral-300"
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: business.color }} />
                      {business.name}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle
            title={
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-neutral-400" />
                Password
              </span>
            }
            subtitle="Changing it signs you out on every device"
          />
        </CardHeader>
        <CardBody>
          <ChangePasswordForm />
        </CardBody>
      </Card>
    </div>
  );
}
