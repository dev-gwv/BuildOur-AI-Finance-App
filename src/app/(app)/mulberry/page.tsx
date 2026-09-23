import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InvoiceList, listedInvoiceSelect, parseStatusFilter } from "@/components/InvoiceList";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function MulberryInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireSessionUser();
  const status = parseStatusFilter((await searchParams).status);

  const invoices = await prisma.invoice.findMany({
    where: { brand: "MULBERRY" },
    orderBy: { createdAt: "desc" },
    select: listedInvoiceSelect,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Invoicing"
        title="The Mulberry Weddings"
        description="Invoices raised from wedding package quotations, with instalments tracked as they come in"
        actions={
          <Link
            href="/mulberry/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" />
            New invoice
          </Link>
        }
      />
      <InvoiceList
        invoices={invoices}
        basePath="/mulberry"
        status={status}
        newHref="/mulberry/new"
        emptyTitle="No Mulberry invoices yet"
        emptyDescription="Upload a wedding package quotation to raise the first one."
      />
    </div>
  );
}
