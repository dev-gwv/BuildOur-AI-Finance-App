import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function InvoicesPage() {
  await requireSessionUser();

  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Tax invoices generated from Bajaj delivery orders, billed by Grateful World Ventures"
        actions={
          <Link href="/invoices/new">
            <Button>
              <Plus className="h-4 w-4" />
              New invoice
            </Button>
          </Link>
        }
      />

      {invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="Upload a Bajaj delivery order to generate your first tax invoice."
          action={
            <Link href="/invoices/new">
              <Button size="sm" className="mt-2">
                <Plus className="h-3.5 w-3.5" />
                New invoice
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Created by</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{inv.customerName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {formatDate(inv.invoiceDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(inv.grossAmount)}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{inv.createdBy.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <DeleteButton url={`/api/invoices/${inv.id}`} label={inv.invoiceNumber} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
