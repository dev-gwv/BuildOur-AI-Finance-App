import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { canAccessBusiness } from "@/server/access";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { PaymentsPanel } from "@/components/PaymentsPanel";
import { PrintButton } from "@/components/PrintButton";
import { SendInvoiceEmail } from "@/components/SendInvoiceEmail";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";

const secondaryAction =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.08]";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { paidOn: "asc" } },
        business: { select: { id: true, name: true, color: true } },
      },
    }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  // Someone without access to the business gets the same answer as a wrong
  // id, so invoice ids can't be probed across businesses.
  if (!invoice || !(await canAccessBusiness(user, invoice.businessId))) notFound();

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          eyebrow={
            <Link href="/invoices" className="inline-flex items-center gap-1.5 hover:underline">
              <span className="h-2 w-2 rounded-full" style={{ background: invoice.business.color }} />
              {invoice.business.name}
            </Link>
          }
          title={invoice.invoiceNumber}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {invoice.customerName}
              {invoice.saleType === "BAJAJ" && <Badge tone="brand">Bajaj Finance sale{invoice.doId ? ` · DO ${invoice.doId}` : ""}</Badge>}
              {invoice.revisedAt && <Badge tone="warning">Revised {formatDate(invoice.revisedAt)}</Badge>}
            </span>
          }
          actions={
            <>
              {invoice.doFilePath && (
                <Link href={`/api/uploads/${invoice.doFilePath}`} target="_blank" rel="noopener noreferrer" className={secondaryAction}>
                  <FileText className="h-4 w-4" />
                  <span className="sm:hidden">{invoice.brand === "MULBERRY" ? "Quotation" : "Original"}</span>
                  <span className="hidden sm:inline">{invoice.brand === "MULBERRY" ? "View quotation" : "View original document"}</span>
                </Link>
              )}
              <Link href={`/invoices/${invoice.id}/edit`} className={secondaryAction}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
              <SendInvoiceEmail invoiceId={invoice.id} customerEmail={invoice.customerEmail} sentAt={invoice.emailSentAt} />
              <PrintButton />
            </>
          }
        />
      </div>

      <PaymentsPanel
        invoiceId={invoice.id}
        total={invoice.grossAmount}
        payments={invoice.payments}
        razorpayRates={{
          feePercent: settings?.razorpayFeePercent ?? 2,
          feeGstPercent: settings?.razorpayFeeGstPercent ?? 18,
        }}
        bajaj={
          invoice.saleType === "BAJAJ"
            ? { financedAmount: invoice.financedAmount ?? invoice.grossAmount - (invoice.downPayment ?? 0), doId: invoice.doId }
            : null
        }
      />

      <InvoiceDocument invoice={invoice} signatureDataUri={settings?.signatureDataUri} payments={invoice.payments} />
    </div>
  );
}
