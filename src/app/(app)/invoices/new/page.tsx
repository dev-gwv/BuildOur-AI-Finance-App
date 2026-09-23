import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope } from "@/server/scope";
import { previewInvoiceNumber } from "@/server/businesses";
import { BRANDS } from "@/lib/brands";
import { InvoiceForm } from "@/components/InvoiceForm";
import { MulberryInvoiceForm } from "@/components/MulberryInvoiceForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const MULBERRY_DEFAULT_NOTES =
  "Thank you for showing trust in our services and your business. Will give our best to give you great memories!";
const MULBERRY_DEFAULT_TERMS = "We have sent the payment and shooting terms separately to you on mail.";

/**
 * A new invoice always belongs to one business. With a business picked in the
 * switcher, its form opens straight away; on "All businesses" the first step
 * is choosing which one — that choice decides the seller, series and sheet.
 */
export default async function NewInvoicePage() {
  const user = await requirePageUser();
  const scope = await getScope(user);
  const business = scope.current;

  if (!business) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="New invoice"
          title="Which business is this invoice for?"
          description="The business decides who the invoice is from, how it's numbered and which Google Sheet it's recorded in."
        />
        {scope.businesses.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="You don't have access to any business yet"
            description="Ask an admin to add you to one in Settings → Team."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {scope.businesses.map((b) => (
              <Link key={b.id} href={`/scope?b=${encodeURIComponent(b.slug)}&next=/invoices/new`} className="group">
                <Card className="h-full p-5 transition-all group-hover:-translate-y-0.5 group-hover:shadow-pop">
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm"
                      style={{ background: b.color }}
                    >
                      {b.name.replace(/^the\s+/i, "").slice(0, 1).toUpperCase()}
                    </span>
                    <ArrowRight className="h-4 w-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-600" />
                  </div>
                  <p className="mt-4 font-semibold text-neutral-900 dark:text-white">{b.name}</p>
                  <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Billed as {BRANDS[b.entity].name}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge>Next: {previewInvoiceNumber(b)}</Badge>
                    <Badge tone={b.entity === "MULBERRY" ? "neutral" : "brand"}>
                      {b.entity === "MULBERRY" ? "From a quotation" : "Bajaj DO / GST certificate"}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const suggestedNumber = previewInvoiceNumber(business);

  if (business.entity === "MULBERRY") {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={`New invoice · ${business.name}`}
          title="Raise from a quotation"
          description="Upload the wedding package quotation — the client, events and total fill in on their own"
        />
        <MulberryInvoiceForm
          businessId={business.id}
          suggestedNumber={suggestedNumber}
          defaultNotes={MULBERRY_DEFAULT_NOTES}
          defaultTerms={MULBERRY_DEFAULT_TERMS}
        />
      </div>
    );
  }

  const [catalog, settings] = await Promise.all([
    prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`New invoice · ${business.name}`}
        title="Generate a tax invoice"
        description="Upload the Bajaj delivery order or the customer's GST certificate — PDF, photo or screenshot. Details fill in on their own."
      />
      <InvoiceForm
        businessId={business.id}
        suggestedNumber={suggestedNumber}
        catalog={catalog}
        defaultTerms={settings?.terms ?? ""}
        defaultNotes={settings?.notes ?? "Thank you for your business."}
      />
    </div>
  );
}
