import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { VENTURES, invoiceHref, nextVentureInvoiceNumber, type VentureKey } from "@/lib/ventures";
import { formatDate } from "@/lib/format";
import { InvoiceList, listedInvoiceSelect, type StatusFilter } from "@/components/InvoiceList";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { InvoiceForm } from "@/components/InvoiceForm";
import { PaymentsPanel } from "@/components/PaymentsPanel";
import { PrintButton } from "@/components/PrintButton";
import { SendInvoiceEmail } from "@/components/SendInvoiceEmail";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";

// IPC and IWC share one set of pages: same seller (Grateful), same document,
// only the series, route and sheet differ — all of which come from VENTURES.

export async function VentureInvoiceList({ venture, status }: { venture: VentureKey; status: StatusFilter }) {
  await requireSessionUser();
  const v = VENTURES[venture];

  const invoices = await prisma.invoice.findMany({
    where: { brand: "GRATEFUL", venture },
    orderBy: { createdAt: "desc" },
    select: listedInvoiceSelect,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Invoicing · Grateful World Ventures"
        title={v.label}
        description={`Tax invoices for the ${venture} venture, numbered ${v.prefix}… and mirrored to the ${v.label} sheet`}
        actions={
          <Link
            href={`${v.path}/new`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" />
            New invoice
          </Link>
        }
      />
      <InvoiceList
        invoices={invoices}
        basePath={v.path}
        status={status}
        showGst
        newHref={`${v.path}/new`}
        emptyTitle={`No ${venture} invoices yet`}
        emptyDescription="Upload a Bajaj delivery order or a GST certificate — PDF, photo or screenshot — to raise the first one."
      />
    </div>
  );
}

export async function VentureNewInvoice({ venture }: { venture: VentureKey }) {
  await requireSessionUser();
  const v = VENTURES[venture];

  const [last, catalog, settings] = await Promise.all([
    prisma.invoice.findFirst({
      where: { brand: "GRATEFUL", venture, invoiceNumber: { startsWith: v.prefix } },
      orderBy: { createdAt: "desc" },
      select: { invoiceNumber: true },
    }),
    prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  const suggestedNumber = nextVentureInvoiceNumber(v, last?.invoiceNumber ?? null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`New ${v.label} invoice`}
        description="Upload the Bajaj delivery order or the customer's GST certificate — details fill in on their own"
      />
      <InvoiceForm
        suggestedNumber={suggestedNumber}
        catalog={catalog}
        defaultTerms={settings?.terms ?? ""}
        defaultNotes={settings?.notes ?? "Thank you for your business."}
        venture={venture}
        successRedirectBase={v.path}
        cancelHref={v.path}
      />
    </div>
  );
}

export async function VentureInvoiceDetail({ venture, id }: { venture: VentureKey; id: string }) {
  await requireSessionUser();

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: { payments: { orderBy: { paidOn: "asc" } } },
    }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  // One venture's URL must not open another's invoice.
  if (!invoice || invoice.brand !== "GRATEFUL" || invoice.venture !== venture) notFound();

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={invoice.invoiceNumber}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {`${VENTURES[venture].label} · ${invoice.customerName}`}
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
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium shadow-sm text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <FileText className="h-4 w-4" />
                  View original document
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
