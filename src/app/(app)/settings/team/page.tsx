import { prisma } from "@/lib/prisma";
import { requirePageAdmin } from "@/server/session";
import { CreateUserForm, UserActions, UserBusinessAccess } from "@/components/settings/TeamForms";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { initials } from "@/lib/format";

function lastSeen(date: Date | null) {
  if (!date) return "Never";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function TeamPage() {
  const me = await requirePageAdmin();

  const [users, businesses] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        lastLoginAt: true,
        businesses: { select: { businessId: true } },
      },
    }),
    prisma.business.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Team"
        description="Who can sign in, and which businesses members can work in. Admins see every business."
        actions={<CreateUserForm businesses={businesses} />}
      />

      <Card className="overflow-visible">
        {/* Scrolls sideways on phones; on wide screens it doesn't, so row menus aren't clipped. */}
        <div className="overflow-x-auto lg:overflow-visible">
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>Role</TH>
                <TH>Businesses</TH>
                <TH>Last sign-in</TH>
                <TH className="w-12" />
              </tr>
            </THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id} className={u.active ? "" : "opacity-60"}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                        {initials(u.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                          {u.name}
                          {!u.active && (
                            <span className="ml-2">
                              <Badge tone="danger">Deactivated</Badge>
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-neutral-500">{u.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={u.role === "ADMIN" ? "brand" : "neutral"}>{u.role === "ADMIN" ? "Admin" : "Member"}</Badge>
                  </TD>
                  <TD>
                    {u.role === "ADMIN" ? (
                      <span className="text-xs text-neutral-500">All businesses</span>
                    ) : (
                      <UserBusinessAccess
                        userId={u.id}
                        businesses={businesses}
                        assigned={u.businesses.map((b) => b.businessId)}
                      />
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-xs">{lastSeen(u.lastLoginAt)}</TD>
                  <TD>
                    <UserActions user={u} isSelf={u.id === me.id} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Changing someone&apos;s role, setting their password or deactivating them signs them out of every device within a
        minute. People are deactivated rather than deleted, so the history of what they recorded stays intact.
      </p>
    </div>
  );
}
