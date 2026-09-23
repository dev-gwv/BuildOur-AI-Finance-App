import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InvoiceList, listedInvoiceSelect, parseStatusFilter } from "@/components/InvoiceList";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireSessionUser();
  const status = parseStatusFilter((await searchParams).status);

  const invoices = await prisma.invoice.findMany({
    where: { brand: "GRATEFUL" },
    orderBy: { createdAt: "desc" },
    select: listedInvoiceSelect,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Invoicing"
        title="Grateful World Ventures"
        description="Every tax invoice under Grateful's GSTIN — IPC, IWC and older ones raised before the ventures were split out"
        actions={
          <Link
            href="/invoices/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200"
          >
            <Plus className="h-4 w-4" />
            Invoice without a venture
          </Link>
        }
      />
      <InvoiceList
        invoices={invoices}
        basePath="/invoices"
        status={status}
        showGst
        showVenture
        newHref="/ipc/new"
        emptyTitle="No invoices yet"
        emptyDescription="Upload a Bajaj delivery order or a GST certificate to raise the first tax invoice."
      />
    </div>
  );
}
