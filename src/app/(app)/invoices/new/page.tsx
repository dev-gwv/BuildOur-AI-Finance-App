import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { formatInvoiceNumber, INVOICE_NUMBER_START } from "@/lib/invoiceSeller";
import { InvoiceForm } from "@/components/InvoiceForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function NewInvoicePage() {
  await requireSessionUser();

  const last = await prisma.invoice.findFirst({ orderBy: { createdAt: "desc" }, select: { invoiceNumber: true } });
  const lastSeq = last ? parseInt(last.invoiceNumber.replace(/\D/g, ""), 10) : INVOICE_NUMBER_START - 1;
  const suggestedNumber = formatInvoiceNumber((Number.isFinite(lastSeq) ? lastSeq : INVOICE_NUMBER_START - 1) + 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Generate tax invoice" description="Upload the Bajaj delivery order to auto-fill the customer and amount" />
      <InvoiceForm suggestedNumber={suggestedNumber} />
    </div>
  );
}
