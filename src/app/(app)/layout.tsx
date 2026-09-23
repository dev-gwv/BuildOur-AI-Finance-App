import { AppShell } from "@/components/AppShell";
import { alertCount } from "@/lib/alerts";
import { isAdmin, requirePageUser } from "@/server/session";
import { getScope } from "@/server/scope";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const scope = await getScope(user);
  // A member's bell only counts the businesses they can see.
  const alerts = await alertCount(scope.access);

  const toShell = (b: (typeof scope.businesses)[number]) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    entity: b.entity,
    color: b.color,
    needsReview: b.needsReview,
  });

  return (
    <AppShell
      name={user.name}
      role={user.role}
      isAdmin={isAdmin(user)}
      alertCount={alerts}
      businesses={scope.businesses.map(toShell)}
      current={scope.current ? toShell(scope.current) : null}
    >
      {children}
    </AppShell>
  );
}
