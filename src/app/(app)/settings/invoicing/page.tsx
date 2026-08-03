import { redirect } from "next/navigation";
import { ListChecks, Settings2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { InvoiceSettingsForm } from "@/components/InvoiceSettingsForm";
import { InlineCreateForm } from "@/components/InlineCreateForm";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency } from "@/lib/format";

export default async function InvoicingSettingsPage() {
  const user = await requireSessionUser();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [settings, catalog] = await Promise.all([
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
    prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoice settings"
        description="Defaults applied to every generated invoice — set once, no retyping"
      />

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-indigo-500" />
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Notes & terms</h2>
        </CardHeader>
        <CardBody>
          <InvoiceSettingsForm defaultTerms={settings?.terms ?? ""} defaultNotes={settings?.notes ?? "Thank you for your business."} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-indigo-500" />
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
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
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
