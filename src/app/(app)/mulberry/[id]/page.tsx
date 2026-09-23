import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { PaymentsPanel } from "@/components/PaymentsPanel";
import { PrintButton } from "@/components/PrintButton";
import { SendInvoiceEmail } from "@/components/SendInvoiceEmail";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import { invoiceHref } from "@/lib/ventures";

export default async function MulberryInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSessionUser();
  const { id } = await params;

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: { payments: { orderBy: { paidOn: "asc" } } },
    }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!invoice || invoice.brand !== "MULBERRY") notFound();

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={invoice.invoiceNumber}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {invoice.customerName}
              {invoice.revisedAt && <Badge tone="warning">Revised {formatDate(invoice.revisedAt)}</Badge>}
            </span>
          }
          actions={
            <>
              {invoice.doFilePath && (
                <Link
                  href={`/api/uploads/${invoice.doFilePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 h-9 text-sm font-medium shadow-sm text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <FileText className="h-4 w-4" />
                  View quotation
                </Link>
              )}
              <Link
                href={`${invoiceHref(invoice)}/edit`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.08]"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
              <SendInvoiceEmail
                invoiceId={invoice.id}
                customerEmail={invoice.customerEmail}
                sentAt={invoice.emailSentAt}
              />
              <PrintButton />
            </>
          }
        />
      </div>

      <PaymentsPanel
        invoiceId={invoice.id}
        total={invoice.grossAmount}
        payments={invoice.payments}
        razorpayRates={{ feePercent: settings?.razorpayFeePercent ?? 2, feeGstPercent: settings?.razorpayFeeGstPercent ?? 18 }}
      />

      <InvoiceDocument
        invoice={invoice}
        signatureDataUri={settings?.signatureDataUri}
        payments={invoice.payments}
      />
    </div>
  );
}
