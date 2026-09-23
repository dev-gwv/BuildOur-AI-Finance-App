import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { DeleteButton } from "@/components/DeleteButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { isInterStateSupply } from "@/lib/gstState";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import { VENTURES, invoiceHref, parseVenture } from "@/lib/ventures";

export type ListedInvoice = {
  id: string;
  brand: string;
  venture: string | null;
  invoiceNumber: string;
  customerName: string;
  customerGstin: string | null;
  invoiceDate: Date;
  dueDate: Date;
  grossAmount: number;
  emailSentAt: Date | null;
  createdBy: { name: string };
  payments: { amount: number }[];
};

export type StatusFilter = "all" | "open" | "paid";

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return value === "open" || value === "paid" ? value : "all";
}

/**
 * The one invoice table every section uses, so Grateful, IPC, IWC and
 * Mulberry read the same: what was billed, what came in, what's still owed.
 */
export function InvoiceList({
  invoices,
  basePath,
  status,
  showGst,
  showVenture,
  newHref,
  emptyTitle,
  emptyDescription,
}: {
  invoices: ListedInvoice[];
  basePath: string;
  status: StatusFilter;
  /** GST-registered sections show whether each bill is IGST or CGST+SGST. */
  showGst?: boolean;
  showVenture?: boolean;
  newHref: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const now = new Date();
  const rows = invoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.round((inv.grossAmount - paid) * 100) / 100;
    return { ...inv, paid, balance };
  });

  const totals = rows.reduce(
    (acc, r) => ({ billed: acc.billed + r.grossAmount, paid: acc.paid + r.paid, due: acc.due + Math.max(0, r.balance) }),
    { billed: 0, paid: 0, due: 0 }
  );
  const openCount = rows.filter((r) => r.balance > 0.5).length;
  const visible = rows.filter((r) => (status === "open" ? r.balance > 0.5 : status === "paid" ? r.balance <= 0.5 : true));

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={emptyTitle}
        description={emptyDescription}
        action={
          <Link
            href={newHref}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white shadow-sm hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-3.5 w-3.5" />
            New invoice
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Billed", value: totals.billed, hint: `${rows.length} invoice${rows.length === 1 ? "" : "s"}`, cls: "text-neutral-950 dark:text-white" },
          { label: "Collected", value: totals.paid, hint: totals.billed > 0 ? `${Math.round((totals.paid / totals.billed) * 100)}% of billed` : "", cls: "text-emerald-600 dark:text-emerald-400" },
          { label: "Outstanding", value: totals.due, hint: `${openCount} open`, cls: totals.due > 0 ? "text-amber-700 dark:text-amber-400" : "text-neutral-950 dark:text-white" },
        ].map((m) => (
          <Card key={m.label} className="px-5 py-4">
            <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{m.label}</p>
            <p className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums ${m.cls}`}>{formatCurrencyWhole(m.value)}</p>
            <p className="mt-0.5 text-xs text-neutral-400">{m.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-white/[0.06]">
          <Segmented
            items={(
              [
                { key: "all", label: `All · ${rows.length}` },
                { key: "open", label: `Open · ${openCount}` },
                { key: "paid", label: `Paid · ${rows.length - openCount}` },
              ] as const
            ).map((s) => ({
              key: s.key,
              label: s.label,
              href: { pathname: basePath, query: s.key === "all" ? {} : { status: s.key } },
              active: status === s.key,
            }))}
          />
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Customer</TH>
                <TH>Date</TH>
                <TH>Status</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Collected</TH>
                <TH className="text-right">Balance</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {visible.map((inv) => {
                const settled = inv.balance <= 0.5;
                const late = !settled && inv.dueDate < now;
                const venture = showVenture ? parseVenture(inv.venture) : null;
                return (
                  <TR key={inv.id}>
                    <TD>
                      <Link
                        href={invoiceHref(inv)}
                        className="font-medium text-neutral-900 hover:text-brand-600 dark:text-neutral-100 dark:hover:text-brand-400"
                      >
                        {inv.invoiceNumber}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {venture && <Badge tone="brand">{VENTURES[venture].label}</Badge>}
                        {showGst && (isInterStateSupply(inv.customerGstin) ? <Badge tone="warning">IGST</Badge> : <Badge>CGST+SGST</Badge>)}
                      </div>
                    </TD>
                    <TD>
                      <p className="font-medium text-neutral-800 dark:text-neutral-200">{inv.customerName}</p>
                      <p className="text-xs text-neutral-400">
                        {inv.customerGstin ?? "B2C"}
                        {inv.emailSentAt && " · emailed"}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(inv.invoiceDate)}</TD>
                    <TD>
                      {settled ? (
                        <Badge tone="success" dot>Paid</Badge>
                      ) : inv.paid > 0 ? (
                        <Badge tone={late ? "danger" : "warning"} dot>Part paid</Badge>
                      ) : (
                        <Badge tone={late ? "danger" : "neutral"} dot>{late ? "Overdue" : "Unpaid"}</Badge>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums font-medium text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(inv.grossAmount)}
                    </TD>
                    <TD className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(inv.paid)}</TD>
                    <TD className={`text-right tabular-nums font-semibold ${settled ? "text-neutral-300 dark:text-neutral-600" : "text-amber-700 dark:text-amber-400"}`}>
                      {settled ? "—" : formatCurrency(inv.balance)}
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end">
                        <DeleteButton url={`/api/invoices/${inv.id}`} label={inv.invoiceNumber} />
                      </div>
                    </TD>
                  </TR>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-neutral-500">
                    No {status === "open" ? "open" : "paid"} invoices.
                  </td>
                </tr>
              )}
            </TBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

export const listedInvoiceSelect = {
  id: true,
  brand: true,
  venture: true,
  invoiceNumber: true,
  customerName: true,
  customerGstin: true,
  invoiceDate: true,
  dueDate: true,
  grossAmount: true,
  emailSentAt: true,
  createdBy: { select: { name: true } },
  payments: { select: { amount: true } },
} as const;
