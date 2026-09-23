import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { canAccessBusiness } from "@/server/access";
import { EntryForm } from "@/components/EntryForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();

  const entry = await prisma.expense.findUnique({ where: { id } });
  // Someone without access to its business gets the same 404 as a missing entry.
  if (!entry || !(await canAccessBusiness(user, entry.businessId))) notFound();

  const business = await prisma.business.findUnique({
    where: { id: entry.businessId },
    select: {
      id: true,
      name: true,
      color: true,
      defaultGstPercent: true,
      gateways: { orderBy: { name: "asc" }, select: { id: true, name: true, chargePercent: true } },
      categories: { orderBy: { name: "asc" }, select: { id: true, name: true } },
    },
  });
  if (!business) notFound();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={business.name} title={entry.direction === "OUT" ? "Edit money out" : "Edit money in"} />
      <EntryForm
        businesses={[business]}
        expense={{
          id: entry.id,
          businessId: entry.businessId,
          categoryId: entry.categoryId,
          gatewayId: entry.gatewayId,
          description: entry.description,
          date: entry.date.toISOString().slice(0, 10),
          grossAmount: entry.grossAmount,
          gstPercent: entry.gstPercent,
          screenshotPath: entry.screenshotPath,
          direction: entry.direction,
        }}
      />
    </div>
  );
}
