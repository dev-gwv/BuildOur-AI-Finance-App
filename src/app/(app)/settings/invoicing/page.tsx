import { ListChecks, Mail, Settings2 } from "lucide-react";
import { BRANDS, type BrandKey } from "@/lib/brands";
import { DEFAULT_TEMPLATES } from "@/lib/emailTemplate";
import { EmailTemplateForm } from "@/components/EmailTemplateForm";
import { prisma } from "@/lib/prisma";
import { requirePageAdmin } from "@/server/session";
import { InvoiceSettingsForm } from "@/components/InvoiceSettingsForm";
import { InlineCreateForm } from "@/components/InlineCreateForm";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency } from "@/lib/format";

export default async function InvoicingSettingsPage() {
  await requirePageAdmin();

  const [settings, catalog, templates] = await Promise.all([
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
    prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } }),
    prisma.emailTemplate.findMany(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Invoice defaults"
        description="Terms, notes, signature, email wording and the item catalog — shared by every business's invoices."
      />

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Notes, terms, signature &amp; Razorpay charges
          </h2>
        </CardHeader>
        <CardBody>
          <InvoiceSettingsForm
            defaultTerms={settings?.terms ?? ""}
            defaultNotes={settings?.notes ?? "Thank you for your business."}
            signatureDataUri={settings?.signatureDataUri ?? null}
            razorpayFeePercent={settings?.razorpayFeePercent ?? 2}
            razorpayFeeGstPercent={settings?.razorpayFeeGstPercent ?? 18}
          />
        </CardBody>
      </Card>

      {(["GRATEFUL", "MULBERRY"] as BrandKey[]).map((key) => {
        const saved = templates.find((t) => t.brand === key);
        const tpl = saved ?? DEFAULT_TEMPLATES[key];
        return (
          <Card key={key}>
            <CardHeader className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-brand-500" />
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Email message — {BRANDS[key].name}
              </h2>
            </CardHeader>
            <CardBody>
              <EmailTemplateForm
                brand={key}
                brandName={BRANDS[key].name}
                subject={tpl.subject}
                body={tpl.body}
                isDefault={!saved}
              />
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Item catalog</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            A Bajaj delivery order only ever states the loan amount, never the product. Map each exact
            amount to what it actually sells as, and the invoice form will auto-fill the item the moment
            a DO with that amount is uploaded.
          </p>

          {catalog.length === 0 ? (
            <EmptyState icon={ListChecks} title="No mappings yet" description="Add your first amount → item mapping below." />
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-white/[0.05]">
              {catalog.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(entry.amount)}
                    </span>
                    <span className="ml-2 text-neutral-600 dark:text-neutral-400">{entry.itemDescription}</span>
                    <span className="ml-2 text-xs text-neutral-400">HSN/SAC {entry.hsnSac}</span>
                  </div>
                  <DeleteButton url={`/api/item-catalog/${entry.id}`} label={entry.itemDescription} />
                </li>
              ))}
            </ul>
          )}

          <InlineCreateForm
            url="/api/item-catalog"
            submitLabel="Add mapping"
            successMessage="Item mapping added"
            fields={[
              { name: "amount", type: "number", step: "0.01", placeholder: "Loan amount (e.g. 117999)" },
              { name: "itemDescription", placeholder: "Item name (e.g. Diamond Premium 2.0)" },
              { name: "hsnSac", placeholder: "HSN/SAC (e.g. 999259)" },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
