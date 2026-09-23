import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isAdmin, requirePageUser } from "@/server/session";
import { canAccessBusiness } from "@/server/access";
import { InvoiceEditForm } from "@/components/InvoiceEditForm";
import { PageHeader } from "@/components/ui/PageHeader";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: { select: { amount: true, method: true } },
      business: { select: { name: true, color: true } },
    },
  });
  if (!invoice || !(await canAccessBusiness(user, invoice.businessId))) notFound();

  // Mirrors the PATCH route: a DO invoice whose only payment is its Bajaj
  // disbursement can change amount freely — the disbursement moves with it.
  const [only] = invoice.payments;
  const bajajOnly =
    invoice.payments.length === 1 && only.method === "Bajaj Finance disbursement" && only.amount === invoice.grossAmount;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);

  // Admins can move an invoice between businesses that bill as the same
  // legal entity — the printed seller can't change after issue.
  const businessOptions = isAdmin(user)
    ? await prisma.business.findMany({
        where: { entity: invoice.brand, archivedAt: null },
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      })
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={`/invoices/${invoice.id}`} className="inline-flex items-center gap-1.5 hover:underline">
            <span className="h-2 w-2 rounded-full" style={{ background: invoice.business.color }} />
            {invoice.business.name} · Edit invoice
          </Link>
        }
        title={invoice.invoiceNumber}
        description={invoice.customerName}
      />
      <InvoiceEditForm
        detailHref={`/invoices/${invoice.id}`}
        minGross={bajajOnly ? 0 : paid}
        businessOptions={businessOptions}
        invoice={{
          id: invoice.id,
          businessId: invoice.businessId,
          brand: invoice.brand,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: day(invoice.invoiceDate),
          dueDate: day(invoice.dueDate),
          customerName: invoice.customerName,
          customerAddress: invoice.customerAddress,
          customerEmail: invoice.customerEmail ?? "",
          customerGstin: invoice.customerGstin ?? "",
          placeOfSupply: invoice.placeOfSupply,
          itemDescription: invoice.itemDescription,
          hsnSac: invoice.hsnSac,
          qty: invoice.qty,
          grossAmount: invoice.grossAmount,
          gstPercent: invoice.gstPercent,
          notes: invoice.notes ?? "",
          terms: invoice.terms ?? "",
          emailSentAt: invoice.emailSentAt ? invoice.emailSentAt.toISOString() : null,
          saleType: invoice.saleType,
          doId: invoice.doId ?? "",
          downPayment: invoice.downPayment ?? 0,
          // A legacy auto-recorded disbursement still follows the amount (see bajajOnly).
          bajajDisbursed: !bajajOnly && invoice.payments.some((p) => p.method === "Bajaj Finance disbursement"),
        }}
      />
    </div>
  );
}
