import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSessionUser();
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) notFound();

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={invoice.invoiceNumber}
          description={invoice.customerName}
          actions={
            <>
              {invoice.doFilePath && (
                <Link
                  href={`/api/uploads/${invoice.doFilePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <FileText className="h-4 w-4" />
                  View original DO
                </Link>
              )}
              <PrintButton />
            </>
          }
        />
      </div>

      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
