import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import { DeleteButton } from "@/components/DeleteButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { isInterStateSupply } from "@/lib/gstState";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";

export type ListedInvoice = {
  id: string;
  brand: string;
  invoiceNumber: string;
  customerName: string;
  customerGstin: string | null;
  invoiceDate: Date;
  dueDate: Date;
  grossAmount: number;
  emailSentAt: Date | null;
  revisedAt: Date | null;
  business: { name: string; color: string };
  payments: { amount: number }[];
};

export const listedInvoiceSelect = {
  id: true,
  brand: true,
  invoiceNumber: true,
  customerName: true,
  customerGstin: true,
  invoiceDate: true,
  dueDate: true,
  grossAmount: true,
  emailSentAt: true,
  revisedAt: true,
  business: { select: { name: true, color: true } },
  payments: { select: { amount: true } },
} as const;

export type StatusFilter = "all" | "open" | "paid";

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return value === "open" || value === "paid" ? value : "all";
}

/** The list's filters, kept in the URL so a filtered view can be shared or bookmarked. */
export type ListFilters = { status: StatusFilter; q: string; period: string };

/**
 * The one invoice table: what was billed, what came in, what's still owed.
 * Filtering by status happens here (it depends on payments); search and
 * period are applied by the page's query.
 */
export function InvoiceList({
  invoices,
  filters,
  periods,
  showBusiness,
  canDelete,
  newHref,
}: {
  invoices: ListedInvoice[];
  filters: ListFilters;
  periods: readonly { key: string; label: string }[];
  /** On "All businesses", each row says which business it belongs to. */
  showBusiness: boolean;
  canDelete: boolean;
  newHref: string;
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
  const overdueCount = rows.filter((r) => r.balance > 0.5 && r.dueDate < now).length;
  const visible = rows.filter((r) =>
    filters.status === "open" ? r.balance > 0.5 : filters.status === "paid" ? r.balance <= 0.5 : true
  );

  const href = (over: Partial<ListFilters>) => {
    const f = { ...filters, ...over };
    return {
      pathname: "/invoices",
      query: {
        ...(f.status !== "all" ? { status: f.status } : {}),
        ...(f.q ? { q: f.q } : {}),
        ...(f.period !== "all" ? { period: f.period } : {}),
      },
    };
  };
  const filtered = Boolean(filters.q) || filters.period !== "all";

  if (invoices.length === 0 && !filtered) {
    return (
      <EmptyState
        icon={FileText}
        title="No invoices yet"
        description="Upload a Bajaj delivery order, a GST certificate or a package quotation to raise the first one."
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
          {
            label: "Billed",
            value: totals.billed,
            hint: `${rows.length} invoice${rows.length === 1 ? "" : "s"}`,
            cls: "text-neutral-950 dark:text-white",
          },
          {
            label: "Collected",
            value: totals.paid,
            hint: totals.billed > 0 ? `${Math.round((totals.paid / totals.billed) * 100)}% of billed` : "",
            cls: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Outstanding",
            value: totals.due,
            hint: `${openCount} open${overdueCount ? ` · ${overdueCount} overdue` : ""}`,
            cls: totals.due > 0 ? "text-amber-700 dark:text-amber-400" : "text-neutral-950 dark:text-white",
          },
        ].map((m) => (
          <Card key={m.label} className="px-5 py-4">
            <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{m.label}</p>
            <p className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums ${m.cls}`}>{formatCurrencyWhole(m.value)}</p>
            <p className="mt-0.5 text-xs text-neutral-400">{m.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-neutral-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-white/[0.06]">
          <div className="flex flex-wrap gap-2">
            <Segmented
              items={(
                [
                  { key: "all", label: `All · ${rows.length}` },
                  { key: "open", label: `Open · ${openCount}` },
                  { key: "paid", label: `Paid · ${rows.length - openCount}` },
                ] as const
              ).map((s) => ({ key: s.key, label: s.label, href: href({ status: s.key }), active: filters.status === s.key }))}
            />
            <Segmented
              items={periods.map((p) => ({ key: p.key, label: p.label, href: href({ period: p.key }), active: filters.period === p.key }))}
            />
          </div>
          <form method="get" action="/invoices" className="relative">
            {filters.status !== "all" && <input type="hidden" name="status" value={filters.status} />}
            {filters.period !== "all" && <input type="hidden" name="period" value={filters.period} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Customer, invoice no. or GSTIN…"
              className="h-9 w-full rounded-xl border border-neutral-200/80 bg-white pl-9 pr-3 text-sm shadow-card outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 lg:w-72 dark:border-white/10 dark:bg-neutral-900/70"
            />
          </form>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[880px]">
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Customer</TH>
                {showBusiness && <TH>Business</TH>}
                <TH>Date</TH>
                <TH>Status</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Collected</TH>
                <TH className="text-right">Balance</TH>
                {canDelete && <TH />}
              </tr>
            </THead>
            <TBody>
              {visible.map((inv) => {
                const settled = inv.balance <= 0.5;
                const late = !settled && inv.dueDate < now;
                return (
                  <TR key={inv.id}>
                    <TD>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="whitespace-nowrap font-medium text-neutral-900 hover:text-brand-600 dark:text-neutral-100 dark:hover:text-brand-400"
                      >
                        {inv.invoiceNumber}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {inv.brand === "GRATEFUL" &&
                          (isInterStateSupply(inv.customerGstin) ? <Badge tone="warning">IGST</Badge> : <Badge>CGST+SGST</Badge>)}
                        {inv.revisedAt && <Badge tone="brand">Revised</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <p className="font-medium text-neutral-800 dark:text-neutral-200">{inv.customerName}</p>
                      <p className="text-xs text-neutral-400">
                        {inv.brand === "GRATEFUL" ? (inv.customerGstin ?? "B2C") : "—"}
                        {inv.emailSentAt && " · emailed"}
                      </p>
                    </TD>
                    {showBusiness && (
                      <TD>
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: inv.business.color }} />
                          {inv.business.name}
                        </span>
                      </TD>
                    )}
                    <TD className="whitespace-nowrap">{formatDate(inv.invoiceDate)}</TD>
                    <TD>
                      {settled ? (
                        <Badge tone="success" dot>
                          Paid
                        </Badge>
                      ) : inv.paid > 0 ? (
                        <Badge tone={late ? "danger" : "warning"} dot>
                          Part paid
                        </Badge>
                      ) : (
                        <Badge tone={late ? "danger" : "neutral"} dot>
                          {late ? "Overdue" : "Unpaid"}
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums font-medium text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(inv.grossAmount)}
                    </TD>
                    <TD className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(inv.paid)}</TD>
                    <TD
                      className={`text-right tabular-nums font-semibold ${settled ? "text-neutral-300 dark:text-neutral-600" : "text-amber-700 dark:text-amber-400"}`}
                    >
                      {settled ? "—" : formatCurrency(inv.balance)}
                    </TD>
                    {canDelete && (
                      <TD>
                        <div className="flex items-center justify-end">
                          <DeleteButton url={`/api/invoices/${inv.id}`} label={inv.invoiceNumber} />
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-neutral-500">
                    No invoices match these filters.
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
