import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { BRANDS, nextInvoiceNumber } from "@/lib/brands";
import { InvoiceForm } from "@/components/InvoiceForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function NewInvoicePage() {
  await requireSessionUser();

  const [last, catalog, settings] = await Promise.all([
    prisma.invoice.findFirst({
      // Venture invoices run their own IPC-/IWC- series and must not advance this one.
      where: { brand: "GRATEFUL", venture: null },
      orderBy: { createdAt: "desc" },
      select: { invoiceNumber: true },
    }),
    prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  const suggestedNumber = nextInvoiceNumber(BRANDS.GRATEFUL, last?.invoiceNumber ?? null);

  return (
    <div className="space-y-6">
      <PageHeader title="Generate tax invoice" description="Upload the Bajaj delivery order — the item, terms, and notes fill in on their own" />
      <InvoiceForm
        suggestedNumber={suggestedNumber}
        catalog={catalog}
        defaultTerms={settings?.terms ?? ""}
        defaultNotes={settings?.notes ?? "Thank you for your business."}
      />
    </div>
  );
}
