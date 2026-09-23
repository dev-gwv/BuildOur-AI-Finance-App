import Link from "next/link";
import { FileText, Lock, Plus, Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { isInterStateSupply } from "@/lib/gstState";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import { startOfToday } from "@/lib/alerts";
import { invoiceBalance } from "@/lib/invoiceLines";

export type ListedInvoice = {
  id: string;
  brand: string;
  invoiceNumber: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  invoiceDate: Date;
  dueDate: Date;
  grossAmount: number;
  emailSentAt: Date | null;
  revisedAt: Date | null;
  saleType: string;
  doId: string | null;
  financedAmount: number | null;
  status: string;
  business: { name: string; color: string; gstLockedThrough: Date | null };
  creditNotes: { grossAmount: number }[];
  payments: { amount: number; method: string | null; kind: string; tdsAmount: number }[];
};

/** Must match BAJAJ_DISBURSEMENT in src/server/services/invoices.ts. */
const BAJAJ_DISBURSEMENT = "Bajaj Finance disbursement";

/** A Bajaj sale Bajaj hasn't paid out on yet — waiting on Bajaj, not on the customer. */
export function awaitingBajaj(inv: Pick<ListedInvoice, "saleType" | "payments">, balance: number): boolean {
  return inv.saleType === "BAJAJ" && balance > 0.5 && !inv.payments.some((p) => p.method === BAJAJ_DISBURSEMENT);
}

export const listedInvoiceSelect = {
  id: true,
  brand: true,
  invoiceNumber: true,
  customerName: true,
  customerGstin: true,
  placeOfSupply: true,
  invoiceDate: true,
  dueDate: true,
  grossAmount: true,
  emailSentAt: true,
  revisedAt: true,
  saleType: true,
  doId: true,
  financedAmount: true,
  status: true,
  business: { select: { name: true, color: true, gstLockedThrough: true } },
  creditNotes: { select: { grossAmount: true } },
  payments: { select: { amount: true, method: true, kind: true, tdsAmount: true } },
} as const;

export type StatusFilter = "all" | "open" | "paid" | "bajaj" | "cancelled";

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return value === "open" || value === "paid" || value === "bajaj" || value === "cancelled" ? value : "all";
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
  newHref,
}: {
  invoices: ListedInvoice[];
  filters: ListFilters;
  periods: readonly { key: string; label: string }[];
  /** On "All businesses", each row says which business it belongs to. */
  showBusiness: boolean;
  newHref: string;
}) {
  // Due dates are calendar days: an invoice due today isn't overdue until tomorrow.
  const today = startOfToday();
  const rows = invoices.map((inv) => {
    // The one balance rule: invoice − credit notes − (receipts − refunds); cancelled owes nothing.
    const b = invoiceBalance(inv);
    const lock = inv.business.gstLockedThrough;
    return {
      ...inv,
      bal: b,
      paid: Math.round((b.received - b.refunded) * 100) / 100,
      balance: b.balance,
      awaiting: !b.cancelled && awaitingBajaj(inv, b.balance),
      locked: Boolean(lock && inv.invoiceDate.getTime() <= lock.getTime()),
    };
  });
  const issued = rows.filter((r) => !r.bal.cancelled);

  const totals = issued.reduce(
    (acc, r) => ({ billed: acc.billed + r.bal.net, paid: acc.paid + r.paid, due: acc.due + r.balance }),
    { billed: 0, paid: 0, due: 0 }
  );
  const openCount = issued.filter((r) => !r.bal.settled).length;
  const paidCount = issued.length - openCount;
  const cancelledCount = rows.length - issued.length;
  // A sale waiting on Bajaj's payout isn't overdue from the customer.
  const overdueCount = issued.filter((r) => !r.bal.settled && !r.awaiting && r.dueDate < today).length;
  const awaitingCount = rows.filter((r) => r.awaiting).length;
  const refundCount = issued.filter((r) => r.bal.toRefund > 0).length;
  // Bajaj owes only the financed part; any unpaid down payment is the customer's.
  const awaitingTotal = rows
    .filter((r) => r.awaiting)
    .reduce((s, r) => s + Math.min(r.financedAmount ?? r.balance, r.balance), 0);
  const visible = rows.filter((r) =>
    filters.status === "open"
      ? !r.bal.cancelled && !r.bal.settled
      : filters.status === "paid"
        ? !r.bal.cancelled && r.bal.settled
        : filters.status === "bajaj"
          ? r.awaiting
          : filters.status === "cancelled"
            ? r.bal.cancelled
            : true
  );

  const status = (inv: (typeof rows)[number]) => {
    const b = inv.bal;
    if (b.cancelled) return <Badge dot>Cancelled</Badge>;
    if (b.toRefund > 0) return <Badge tone="danger" dot>To refund</Badge>;
    const late = !b.settled && inv.dueDate < today;
    if (b.settled) return b.credited > 0 ? <Badge tone="success" dot>{b.net > 0 ? "Paid · credited" : "Credited"}</Badge> : <Badge tone="success" dot>Paid</Badge>;
    // Waiting on Bajaj's payout isn't the customer being late.
    if (inv.awaiting) return <Badge tone="brand" dot>Awaiting Bajaj</Badge>;
    if (inv.paid > 0) return <Badge tone={late ? "danger" : "warning"} dot>Part paid</Badge>;
    return <Badge tone={late ? "danger" : "neutral"} dot>{late ? "Overdue" : "Unpaid"}</Badge>;
  };
  const lockIcon = (
    <span title="GST for this period is filed — correct it with a credit note" className="inline-flex text-neutral-400">
      <Lock className="h-3 w-3" aria-label="Filed GST period" />
    </span>
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
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          {
            label: "Billed",
            value: totals.billed,
            hint: `${issued.length} invoice${issued.length === 1 ? "" : "s"}${cancelledCount ? ` · ${cancelledCount} cancelled` : ""}`,
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
            hint: `${openCount} open${overdueCount ? ` · ${overdueCount} overdue` : ""}${
              awaitingCount ? ` · ${formatCurrencyWhole(awaitingTotal)} awaiting Bajaj` : ""
            }${refundCount ? ` · ${refundCount} to refund` : ""}`,
            cls: totals.due > 0 ? "text-amber-700 dark:text-amber-400" : "text-neutral-950 dark:text-white",
          },
        ].map((m) => (
          <Card key={m.label} className="px-3 py-3 sm:px-5 sm:py-4">
            <p className="text-xs font-medium text-neutral-500 sm:text-[13px] dark:text-neutral-400">{m.label}</p>
            <p className={`mt-1 truncate text-[15px] font-semibold tracking-tight tabular-nums sm:mt-1.5 sm:text-xl ${m.cls}`}>
              {formatCurrencyWhole(m.value)}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-neutral-400 sm:text-xs">{m.hint}</p>
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
                  { key: "paid", label: `Paid · ${paidCount}` },
                  ...(awaitingCount > 0 || filters.status === "bajaj"
                    ? [{ key: "bajaj" as const, label: `Awaiting Bajaj · ${awaitingCount}` }]
                    : []),
                  ...(cancelledCount > 0 || filters.status === "cancelled"
                    ? [{ key: "cancelled" as const, label: `Cancelled · ${cancelledCount}` }]
                    : []),
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
        {/* Phones: one card per invoice with what matters at a glance. */}
        <ul className="divide-y divide-neutral-100 sm:hidden dark:divide-white/[0.05]">
          {visible.map((inv) => (
            <li key={inv.id}>
              <Link href={`/invoices/${inv.id}`} className="block px-4 py-3 active:bg-neutral-50 dark:active:bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`flex items-center gap-1.5 truncate font-medium text-neutral-900 dark:text-neutral-100 ${inv.bal.cancelled ? "line-through decoration-neutral-400" : ""}`}
                  >
                    {inv.invoiceNumber}
                    {inv.locked && lockIcon}
                  </span>
                  {status(inv)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                  {showBusiness && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: inv.business.color }} />}
                  <span className="truncate">{inv.customerName}</span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{formatDate(inv.invoiceDate)}</span>
                  <span className="tabular-nums">
                    <span className={`text-sm font-semibold ${inv.bal.cancelled ? "text-neutral-400 line-through" : "text-neutral-900 dark:text-neutral-100"}`}>
                      {formatCurrency(inv.grossAmount)}
                    </span>
                    {!inv.bal.settled && inv.paid > 0 && (
                      <span className="ml-1.5 text-amber-700 dark:text-amber-400">{formatCurrency(inv.balance)} due</span>
                    )}
                    {inv.bal.toRefund > 0 && <span className="ml-1.5 text-red-600 dark:text-red-400">{formatCurrency(inv.bal.toRefund)} to refund</span>}
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-10 text-center text-sm text-neutral-500">No invoices match these filters.</li>}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
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
              </tr>
            </THead>
            <TBody>
              {visible.map((inv) => {
                const settled = inv.bal.settled;
                return (
                  <TR key={inv.id}>
                    <TD>
                      <span className="flex items-center gap-1.5">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className={`whitespace-nowrap font-medium text-neutral-900 hover:text-brand-600 dark:text-neutral-100 dark:hover:text-brand-400 ${
                            inv.bal.cancelled ? "line-through decoration-neutral-400" : ""
                          }`}
                        >
                          {inv.invoiceNumber}
                        </Link>
                        {inv.locked && lockIcon}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {inv.brand === "GRATEFUL" &&
                          (isInterStateSupply(inv.customerGstin, inv.placeOfSupply) ? <Badge tone="warning">IGST</Badge> : <Badge>CGST+SGST</Badge>)}
                        {inv.saleType === "BAJAJ" && <Badge>Bajaj</Badge>}
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
                    <TD>{status(inv)}</TD>
                    <TD
                      className={`text-right tabular-nums font-medium ${inv.bal.cancelled ? "text-neutral-400 line-through" : "text-neutral-900 dark:text-neutral-100"}`}
                    >
                      {formatCurrency(inv.grossAmount)}
                      {inv.bal.credited > 0 && (
                        <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">−{formatCurrency(inv.bal.credited)} credited</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{inv.bal.cancelled ? "—" : formatCurrency(inv.paid)}</TD>
                    <TD
                      className={`text-right tabular-nums font-semibold ${
                        inv.bal.toRefund > 0
                          ? "text-red-600 dark:text-red-400"
                          : settled
                            ? "text-neutral-500 dark:text-neutral-400"
                            : "text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      {inv.bal.toRefund > 0 ? `−${formatCurrency(inv.bal.toRefund)}` : settled ? "—" : formatCurrency(inv.balance)}
                    </TD>
                  </TR>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-neutral-500">
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
