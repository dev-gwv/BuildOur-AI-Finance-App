import Link from "next/link";
import { ArrowRight, Building2, FileBadge, Landmark } from "lucide-react";
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
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
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
                      {b.entity === "MULBERRY" ? "From a quotation" : "Bajaj sale or direct sale"}
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

  // A Grateful invoice is one of two different sales; pick which before the form.
  const saleType = type === "bajaj" ? "BAJAJ" : type === "direct" ? "DIRECT" : null;
  if (!saleType) {
    const options = [
      {
        key: "bajaj",
        icon: Landmark,
        title: "Bajaj Finance sale",
        body: "The customer bought on Bajaj EMI. Upload the delivery order — the customer, DO number, price and down payment fill in.",
        points: ["Invoice for the full product price", "Tracked as awaiting Bajaj until the payout reaches the bank", "Bajaj's charges worked out when you record the payout"],
      },
      {
        key: "direct",
        icon: FileBadge,
        title: "Direct sale",
        body: "The customer pays you themselves — UPI, bank transfer, Razorpay or cash. Upload their GST certificate, or enter the details.",
        points: ["B2B with a GST certificate (IGST worked out from the GSTIN)", "Or a walk-in customer without one", "Record payments as they come in"],
      },
    ];
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={`New invoice · ${business.name}`}
          title="What kind of sale is this?"
          description="Both print the same tax invoice. They're tracked differently afterwards, because Bajaj pays you later and keeps its charges."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {options.map((o) => (
            <Link key={o.key} href={`/invoices/new?type=${o.key}`} className="group">
              <Card className="flex h-full flex-col p-6 transition-all group-hover:-translate-y-0.5 group-hover:shadow-pop">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900">
                    <o.icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-600" />
                </div>
                <p className="mt-4 text-lg font-semibold text-neutral-900 dark:text-white">{o.title}</p>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{o.body}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-300">
                  {o.points.map((pt) => (
                    <li key={pt} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </Card>
            </Link>
          ))}
        </div>
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
        title={saleType === "BAJAJ" ? "Bajaj Finance sale" : "Direct sale"}
        description={
          saleType === "BAJAJ"
            ? "Upload Bajaj's delivery order — PDF, photo or screenshot. The invoice is for the full price; Bajaj's payout is recorded when it reaches the bank."
            : "Upload the customer's GST certificate, or fill in the details for a customer without one."
        }
      />
      <InvoiceForm
        key={saleType}
        saleType={saleType}
        businessId={business.id}
        suggestedNumber={suggestedNumber}
        catalog={catalog}
        defaultTerms={settings?.terms ?? ""}
        defaultNotes={settings?.notes ?? "Thank you for your business."}
      />
    </div>
  );
}
