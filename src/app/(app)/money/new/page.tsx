import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope } from "@/server/scope";
import { EntryForm } from "@/components/EntryForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function NewEntryPage() {
  const user = await requirePageUser();
  const scope = await getScope(user);
  // Fixed to the business being worked in; on "All", the form lets you pick.
  const ids = scope.current ? [scope.current.id] : scope.businesses.map((b) => b.id);

  const businesses = await prisma.business.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      defaultGstPercent: true,
      gateways: { orderBy: { name: "asc" }, select: { id: true, name: true, chargePercent: true } },
      categories: { orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { expenses: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scope.current?.name ?? "All businesses"}
        title="Add an entry"
        description="Money in (received through a gateway) or money out (a cost the business paid)"
      />
      <EntryForm businesses={businesses} />
    </div>
  );
}
