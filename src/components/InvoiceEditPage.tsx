import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InvoiceEditForm } from "@/components/InvoiceEditForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { invoiceHref, type VentureKey } from "@/lib/ventures";

export type InvoiceSection = "invoices" | VentureKey | "MULBERRY";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Edit screen shared by every invoice section; 404s when the id belongs to another one. */
export async function InvoiceEditPage({ id, section }: { id: string; section: InvoiceSection }) {
  await requireSessionUser();

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true, method: true } } },
  });
  if (!invoice) notFound();
  const belongs =
    section === "MULBERRY"
      ? invoice.brand === "MULBERRY"
      : section === "invoices"
        ? invoice.brand === "GRATEFUL"
        : invoice.brand === "GRATEFUL" && invoice.venture === section;
  if (!belongs) notFound();

  // Mirrors the PATCH route: a DO invoice whose only payment is its Bajaj
  // disbursement can change amount freely — the disbursement moves with it.
  const [only] = invoice.payments;
  const bajajOnly =
    invoice.payments.length === 1 &&
    only.method === "Bajaj Finance disbursement" &&
    only.amount === invoice.grossAmount;
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Edit invoice" title={invoice.invoiceNumber} description={invoice.customerName} />
      <InvoiceEditForm
        detailHref={invoiceHref(invoice)}
        minGross={bajajOnly ? 0 : paid}
        invoice={{
          id: invoice.id,
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
        }}
      />
    </div>
  );
}
