import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { BRANDS, nextInvoiceNumber } from "@/lib/brands";
import { MulberryInvoiceForm } from "@/components/MulberryInvoiceForm";
import { PageHeader } from "@/components/ui/PageHeader";

const MULBERRY_DEFAULT_NOTES =
  "Thank you for showing trust in our services and your business. Will give our best to give you great memories!";
const MULBERRY_DEFAULT_TERMS = "We have sent the payment and shooting terms separately to you on mail.";

export default async function NewMulberryInvoicePage() {
  await requireSessionUser();

  const last = await prisma.invoice.findFirst({
    where: { brand: "MULBERRY" },
    orderBy: { createdAt: "desc" },
    select: { invoiceNumber: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Mulberry invoice"
        description="Upload the wedding package quotation — the client, events and total fill in on their own"
      />
      <MulberryInvoiceForm
        suggestedNumber={nextInvoiceNumber(BRANDS.MULBERRY, last?.invoiceNumber ?? null)}
        defaultNotes={MULBERRY_DEFAULT_NOTES}
        defaultTerms={MULBERRY_DEFAULT_TERMS}
      />
    </div>
  );
}
