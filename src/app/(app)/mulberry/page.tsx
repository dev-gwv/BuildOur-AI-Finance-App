import Link from "next/link";
import { Plus, Camera } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";

export default async function MulberryInvoicesPage() {
  await requireSessionUser();

  const invoices = await prisma.invoice.findMany({
    where: { brand: "MULBERRY" },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } }, payments: { select: { amount: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="The Mulberry Weddings"
        description="Invoices raised from wedding package quotations, with payments tracked as they come in"
        actions={
          <Link href="/mulberry/new">
            <Button>
              <Plus className="h-4 w-4" />
              New invoice
            </Button>
          </Link>
        }
      />

      {invoices.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No Mulberry invoices yet"
          description="Upload a wedding package quotation to raise the first one."
          action={
            <Link href="/mulberry/new">
              <Button size="sm" className="mt-2">
                <Plus className="h-3.5 w-3.5" />
                New invoice
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-right font-medium">Received</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {invoices.map((inv) => {
                const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
                const balance = Math.round((inv.grossAmount - paid) * 100) / 100;
                return (
                  <tr key={inv.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/mulberry/${inv.id}`}
                        className="font-medium text-rose-700 hover:underline dark:text-rose-400"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{inv.customerName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {formatDate(inv.invoiceDate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(inv.grossAmount)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(paid)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {balance <= 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                          Paid
                        </span>
                      ) : (
                        <span className="tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                          {formatCurrency(balance)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <DeleteButton url={`/api/invoices/${inv.id}`} label={inv.invoiceNumber} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
