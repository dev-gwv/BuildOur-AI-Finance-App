import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, FileText, Lock, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isAdmin, requirePageUser } from "@/server/session";
import { canAccessBusiness } from "@/server/access";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { PaymentsPanel } from "@/components/PaymentsPanel";
import { DownloadPdfButton, PrintButton } from "@/components/PrintButton";
import { SendInvoiceEmail } from "@/components/SendInvoiceEmail";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import { invoiceBalance } from "@/lib/invoiceLines";
import { isInterStateSupply } from "@/lib/gstState";
import { creditNoteTax } from "@/server/services/creditNotes";
import { CreditNotesPanel } from "@/components/invoices/CreditNotesPanel";
import { CancelInvoiceDialog } from "@/components/invoices/CancelInvoiceDialog";

const iso = (d: Date) => d.toISOString().slice(0, 10);

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
        lines: { orderBy: { position: "asc" } },
        creditNotes: { orderBy: { noteDate: "asc" } },
        business: {
          select: { id: true, name: true, color: true, gstLockedThrough: true },
        },
      },
    }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  // Someone without access to the business gets the same answer as a wrong
  // id, so invoice ids can't be probed across businesses.
  if (!invoice || !(await canAccessBusiness(user, invoice.businessId))) notFound();

  // The one balance rule, shared with every list and report.
  const balance = invoiceBalance(invoice);
  const cancelled = balance.cancelled;
  const lock = invoice.business.gstLockedThrough;
  const locked = Boolean(lock && invoice.invoiceDate.getTime() <= lock.getTime());
  const gstRegistered = invoice.brand === "GRATEFUL";
  const biggestLine = [...invoice.lines].sort((a, b) => b.grossAmount - a.grossAmount)[0];
  const cancelBlocked = cancelled
    ? null
    : invoice.creditNotes.length
      ? "This invoice has a credit note — reduce it further with another credit note instead of cancelling."
      : balance.received - balance.refunded > 0.5
        ? "Money has been received against this invoice. Refund it (or delete a payment recorded by mistake) first, or issue a credit note."
        : locked
          ? `GST is already filed through ${formatDate(lock!)} — issue a credit note dated today instead.`
          : null;

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
              {invoice.saleType === "BAJAJ" && (
                <Badge tone="brand">
                  Bajaj Finance sale
                  {invoice.doId ? ` · DO ${invoice.doId}` : ""}
                </Badge>
              )}
              {invoice.revisedAt && <Badge tone="warning">Revised {formatDate(invoice.revisedAt)}</Badge>}
              {cancelled && <Badge tone="danger">Cancelled</Badge>}
              {locked && !cancelled && (
                <Badge>
                  <Lock className="h-3 w-3" /> GST filed
                </Badge>
              )}
            </span>
          }
          actions={
            <>
              {invoice.doFilePath && (
                <Link
                  href={`/api/uploads/${invoice.doFilePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={secondaryAction}
                >
                  <FileText className="h-4 w-4" />
                  <span className="sm:hidden">{invoice.brand === "MULBERRY" ? "Quotation" : "Original"}</span>
                  <span className="hidden sm:inline">
                    {invoice.brand === "MULBERRY" ? "View quotation" : "View original document"}
                  </span>
                </Link>
              )}
              {!cancelled && !locked && (
                <Link href={`/invoices/${invoice.id}/edit`} className={secondaryAction}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              )}
              {!cancelled && (
                <SendInvoiceEmail invoiceId={invoice.id} customerEmail={invoice.customerEmail} sentAt={invoice.emailSentAt} />
              )}
              <DownloadPdfButton invoiceId={invoice.id} />
              <PrintButton />
              {!cancelled && (
                <CancelInvoiceDialog invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber} blockedReason={cancelBlocked} />
              )}
            </>
          }
        />
      </div>

      {cancelled && (
        <div className="flex items-start gap-3 rounded-2xl border border-neutral-300 bg-neutral-100 px-5 py-4 text-sm text-neutral-800 print:hidden dark:border-white/15 dark:bg-white/[0.05] dark:text-neutral-200">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
          <div>
            <p className="font-semibold">
              Cancelled
              {invoice.cancelledAt ? ` on ${formatDate(invoice.cancelledAt)}` : ""}
            </p>
            <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">
              {invoice.cancelReason ? `${invoice.cancelReason}. ` : ""}It keeps its number but counts for nothing — not in totals,
              dues or the GST report.
            </p>
          </div>
        </div>
      )}
      {locked && !cancelled && (
        <div className="flex items-start gap-3 rounded-2xl border border-neutral-200/80 bg-white px-5 py-3 text-sm text-neutral-700 print:hidden dark:border-white/[0.07] dark:bg-neutral-900/70 dark:text-neutral-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
          <p>
            GST for this invoice&apos;s period is filed (through {formatDate(lock!)}), so it can&apos;t be edited or cancelled.
            Correct it with a credit note dated today.
          </p>
        </div>
      )}

      {/* A cancelled invoice with nothing recorded has no payments story to tell. */}
      {(!cancelled || invoice.payments.length > 0) && (
        <div id="payments" className="scroll-mt-20">
          <PaymentsPanel
            invoiceId={invoice.id}
            // The panel works out the net itself (invoice − credit notes) with
            // invoiceBalance, so it gets the gross total plus the credit notes.
            total={invoice.grossAmount}
            creditNotes={invoice.creditNotes}
            status={invoice.status}
            payments={invoice.payments}
            razorpayRates={{
              feePercent: settings?.razorpayFeePercent ?? 2,
              feeGstPercent: settings?.razorpayFeeGstPercent ?? 18,
            }}
            bajaj={
              invoice.saleType === "BAJAJ"
                ? {
                    financedAmount: invoice.financedAmount ?? invoice.grossAmount - (invoice.downPayment ?? 0),
                    doId: invoice.doId,
                  }
                : null
            }
          />
        </div>
      )}

      {(!cancelled || invoice.creditNotes.length > 0) && (
        <CreditNotesPanel
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          invoiceDate={iso(invoice.invoiceDate)}
          creditNotes={invoice.creditNotes.map((cn) => ({
            id: cn.id,
            number: cn.number,
            noteDate: iso(cn.noteDate),
            reason: cn.reason,
            grossAmount: cn.grossAmount,
            gstPercent: cn.gstPercent,
            ...creditNoteTax(cn, invoice),
          }))}
          net={balance.net}
          toRefund={balance.toRefund}
          gstRegistered={gstRegistered}
          interState={isInterStateSupply(invoice.customerGstin, invoice.placeOfSupply)}
          defaultRate={gstRegistered ? (biggestLine?.gstPercent ?? invoice.gstPercent) : 0}
          lockedThrough={lock ? iso(lock) : null}
          canDelete={isAdmin(user)}
          cancelled={cancelled}
        />
      )}

      <InvoiceDocument
        invoice={invoice}
        signatureDataUri={settings?.signatureDataUri}
        payments={invoice.payments}
        creditNotes={invoice.creditNotes.map((cn) => ({
          number: cn.number,
          noteDate: cn.noteDate,
          grossAmount: cn.grossAmount,
        }))}
      />
    </div>
  );
}
