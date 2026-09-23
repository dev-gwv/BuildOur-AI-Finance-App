import Link from "next/link";
import { Ban, Download, FileText, Info, Landmark, Lock, Percent, Receipt, Scale, Undo2 } from "lucide-react";
import { requirePageUser } from "@/server/session";
import { getScope } from "@/server/scope";
import { GST_PERIODS, monthLabel, parseGstPeriod, type GstCreditLine, type GstLine, type GstTotals } from "@/lib/gstReport";
import { gstBusinesses, loadGstReport, resolveGstBusinessIds } from "@/lib/gstReportData";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Segmented } from "@/components/ui/Segmented";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";

function TotalsRow({ label, t, strong, sub }: { label: string; t: GstTotals; strong?: boolean; sub?: boolean }) {
  const cls = strong ? "font-semibold text-neutral-900 dark:text-white" : sub ? "text-xs" : "";
  return (
    <>
      <TD className={`${cls} ${sub ? "pl-8" : ""}`}>{label}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{t.count}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{formatCurrency(t.taxable)}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{formatCurrency(t.cgst)}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{formatCurrency(t.sgst)}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{formatCurrency(t.igst)}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{formatCurrency(t.tax)}</TD>
      <TD className={`text-right tabular-nums ${cls}`}>{formatCurrency(t.value)}</TD>
    </>
  );
}

function InvoiceTable({
  lines,
  title,
  subtitle,
  showBusiness,
}: {
  lines: GstLine[];
  title: string;
  subtitle: string;
  showBusiness: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle title={title} subtitle={subtitle} />
      </CardHeader>
      {lines.length === 0 ? (
        <CardBody>
          <p className="text-sm text-neutral-500">None in this period.</p>
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1080px]">
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Date</TH>
                <TH>Customer</TH>
                <TH>GSTIN</TH>
                <TH>Place of supply</TH>
                <TH className="text-right">Taxable</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">CGST</TH>
                <TH className="text-right">SGST</TH>
                <TH className="text-right">IGST</TH>
                <TH className="text-right">Invoice value</TH>
              </tr>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <span className="whitespace-nowrap font-medium text-neutral-900 dark:text-neutral-100">{l.invoiceNumber}</span>
                    {l.interState && (
                      <span className="ml-1.5">
                        <Badge tone="warning">IGST</Badge>
                      </span>
                    )}
                    {showBusiness && <span className="block text-xs text-neutral-400">{l.business}</span>}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(l.invoiceDate)}</TD>
                  <TD className="max-w-48 truncate">{l.customerName}</TD>
                  <TD className="font-mono text-xs">{l.customerGstin ?? "—"}</TD>
                  <TD>{l.placeOfSupply}</TD>
                  <TD className="text-right tabular-nums">{formatCurrency(l.taxable)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    {[...new Set(l.hsn.map((h) => h.gstPercent))].map((r) => `${r}%`).join(" · ") || `${l.gstPercent}%`}
                  </TD>
                  <TD className="text-right tabular-nums">{l.cgst ? formatCurrency(l.cgst) : "—"}</TD>
                  <TD className="text-right tabular-nums">{l.sgst ? formatCurrency(l.sgst) : "—"}</TD>
                  <TD className="text-right tabular-nums">{l.igst ? formatCurrency(l.igst) : "—"}</TD>
                  <TD className="text-right font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(l.value)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default async function GstReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; business?: string }>;
}) {
  const params = await searchParams;
  const period = parseGstPeriod(params.period);
  const user = await requirePageUser();
  const scope = await getScope(user);
  // Only businesses billing under a GST-registered entity have a GST report.
  const candidates = gstBusinesses(scope);
  const businessIds = resolveGstBusinessIds(scope, params.business);
  const selected = businessIds.length === 1 && candidates.length > 1 ? businessIds[0] : null;
  const report = await loadGstReport({ businessIds, period });

  const query = (o: { period?: string; business?: string | null }) => {
    const p = o.period ?? period;
    const b = o.business === undefined ? selected : o.business;
    return { ...(p !== "month" ? { period: p } : {}), ...(b ? { business: b } : {}) };
  };
  const exportHref = `/api/export/gst?${new URLSearchParams({
    ...(period !== "month" ? { period } : {}),
    ...(businessIds.length === 1 ? { businessId: businessIds[0] } : {}),
  }).toString()}`;
  const lastDay = new Date(report.range.end.getTime() - 86_400_000);
  const rangeLabel = `${formatDate(report.range.start)} – ${formatDate(lastDay)}`;
  const scopeLabel =
    businessIds.length === 1
      ? (candidates.find((c) => c.id === businessIds[0])?.name ?? "")
      : `${candidates.length} businesses`;
  const showBusiness = businessIds.length > 1;

  if (candidates.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Reports" title="GST report" />
        <EmptyState
          icon={Landmark}
          title={scope.current ? `${scope.current.name} doesn't charge GST` : "No GST-registered business"}
          description="The GST report covers businesses that bill under a GST-registered entity (Grateful World Ventures). Switch business in the sidebar to see one."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="GST report"
        description={`Output tax on Grateful World Ventures' invoices (GSTIN 07AAJCG9243K1Z5), laid out like GSTR-1 · ${scopeLabel} · ${rangeLabel}`}
        actions={
          <a
            href={exportHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Download className="h-4 w-4" />
            Export to Excel
          </a>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {candidates.length > 1 ? (
          <Segmented
            items={[
              { key: "all", label: "All of Grateful", href: { pathname: "/reports/gst", query: query({ business: null }) }, active: !selected },
              ...candidates.map((c) => ({
                key: c.id,
                label: (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                ),
                href: { pathname: "/reports/gst", query: query({ business: c.id }) },
                active: selected === c.id,
              })),
            ]}
          />
        ) : (
          <span />
        )}
        <Segmented
          items={GST_PERIODS.map((p) => ({
            key: p.key,
            label: p.label,
            href: { pathname: "/reports/gst", query: query({ period: p.key }) },
            active: period === p.key,
          }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Taxable turnover"
          value={formatCurrencyWhole(report.netOutput.taxable)}
          icon={FileText}
          hint={`${report.output.count} invoice${report.output.count === 1 ? "" : "s"}${
            report.credits.length ? ` · less ${report.credits.length} credit note${report.credits.length === 1 ? "" : "s"}` : ""
          }`}
        />
        <StatCard
          label="Output GST"
          value={formatCurrencyWhole(report.netOutput.tax)}
          icon={Percent}
          tone="warning"
          hint={
            report.credits.length
              ? `${formatCurrencyWhole(report.output.tax)} on invoices − ${formatCurrencyWhole(report.creditTotals.tax)} credited`
              : `IGST ${formatCurrencyWhole(report.output.igst)} · CGST+SGST ${formatCurrencyWhole(report.output.cgst + report.output.sgst)}`
          }
        />
        <StatCard
          label="Input tax credit"
          value={formatCurrencyWhole(report.input.total)}
          icon={Receipt}
          tone="success"
          hint="estimate · costs + gateway fees"
        />
        <StatCard
          label={report.netPayable >= 0 ? "Net GST payable" : "Credit carried forward"}
          value={formatCurrencyWhole(Math.abs(report.netPayable))}
          icon={Scale}
          tone={report.netPayable > 0 ? "danger" : "success"}
          hint="estimate, before your CA's review"
        />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          An estimate to hand to your CA, not a return. Output tax is worked out from each invoice exactly as it was
          printed. Input credit only counts GST on costs logged as money out and the GST a gateway charged on its
          commission. It doesn&apos;t check eligibility or GSTR-2B matching, and it leaves out anything not recorded here.
        </p>
      </div>

      {report.locks.some((l) => l.through) && (
        <div className="flex items-start gap-3 rounded-xl border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-700 dark:border-white/[0.07] dark:bg-neutral-900/70 dark:text-neutral-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
          <p>
            {report.locks
              .filter((l) => l.through)
              .map((l) => `${l.business}: GST filed through ${formatDate(l.through!)}`)
              .join(" · ")}
            . Invoices, credit notes and costs dated on or before that are locked; correct them with a credit note dated today.
          </p>
        </div>
      )}

      {report.lines.length === 0 && report.credits.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No tax invoices in this period"
          description="Invoices raised under Grateful World Ventures show up here by invoice date."
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle title="Month by month" subtitle="Output tax by return period, split B2B (has a GSTIN) and B2C" />
            </CardHeader>
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <THead>
                  <tr>
                    <TH>Period</TH>
                    <TH className="text-right">Invoices</TH>
                    <TH className="text-right">Taxable</TH>
                    <TH className="text-right">CGST</TH>
                    <TH className="text-right">SGST</TH>
                    <TH className="text-right">IGST</TH>
                    <TH className="text-right">Total tax</TH>
                    <TH className="text-right">Invoice value</TH>
                  </tr>
                </THead>
                <TBody>
                  {report.months.map((m) => (
                    <FragmentRows key={m.month} label={monthLabel(m.month)} m={m} />
                  ))}
                  <TR className="bg-neutral-50/70 dark:bg-white/[0.02]">
                    <TotalsRow label="Invoices" t={report.output} strong />
                  </TR>
                  {report.credits.length > 0 && (
                    <>
                      <TR className="bg-neutral-50/70 dark:bg-white/[0.02]">
                        <TotalsRow label="Less credit notes" t={negate(report.creditTotals)} />
                      </TR>
                      <TR className="bg-neutral-50/70 dark:bg-white/[0.02]">
                        <TotalsRow label="Net output" t={report.netOutput} strong />
                      </TR>
                    </>
                  )}
                </TBody>
              </Table>
            </div>
          </Card>

          <InvoiceTable
            lines={report.lines.filter((l) => l.b2b)}
            title={`B2B invoices · ${report.b2b.count}`}
            subtitle={`Reported invoice by invoice (GSTR-1 table 4) · tax ${formatCurrency(report.b2b.tax)}`}
            showBusiness={showBusiness}
          />
          <InvoiceTable
            lines={report.lines.filter((l) => !l.b2b)}
            title={`B2C invoices · ${report.b2c.count}`}
            subtitle={`Customers without a GSTIN, reported in aggregate (table 7) · tax ${formatCurrency(report.b2c.tax)}`}
            showBusiness={showBusiness}
          />

          <CreditNoteTable credits={report.credits} showBusiness={showBusiness} cdnrTax={report.cdnr.tax} cdnurTax={report.cdnur.tax} />

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle title="HSN / SAC summary" subtitle="GSTR-1 table 12 · per code and rate, net of credit notes" />
            </CardHeader>
            {report.hsn.length === 0 ? (
              <CardBody>
                <p className="text-sm text-neutral-500">None in this period.</p>
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <THead>
                    <tr>
                      <TH>HSN / SAC</TH>
                      <TH className="text-right">Rate</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Taxable</TH>
                      <TH className="text-right">CGST</TH>
                      <TH className="text-right">SGST</TH>
                      <TH className="text-right">IGST</TH>
                      <TH className="text-right">Total value</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {report.hsn.map((h) => (
                      <TR key={`${h.hsnSac}|${h.gstPercent}`}>
                        <TD className="font-mono text-xs text-neutral-900 dark:text-neutral-100">{h.hsnSac || "—"}</TD>
                        <TD className="text-right tabular-nums">{h.gstPercent}%</TD>
                        <TD className="text-right tabular-nums">{h.qty}</TD>
                        <TD className="text-right tabular-nums">{formatCurrency(h.taxable)}</TD>
                        <TD className="text-right tabular-nums">{h.cgst ? formatCurrency(h.cgst) : "—"}</TD>
                        <TD className="text-right tabular-nums">{h.sgst ? formatCurrency(h.sgst) : "—"}</TD>
                        <TD className="text-right tabular-nums">{h.igst ? formatCurrency(h.igst) : "—"}</TD>
                        <TD className="text-right font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrency(h.total)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {report.cancelled.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle
              title={
                <span className="flex items-center gap-2">
                  <Ban className="h-4 w-4 text-neutral-400" />
                  Cancelled, not reported · {report.cancelled.length}
                </span>
              }
              subtitle="These numbers were issued and then cancelled. They stay in the series with nothing reported against them."
            />
          </CardHeader>
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH>Reason</TH>
                  <TH className="text-right">Was</TH>
                </tr>
              </THead>
              <TBody>
                {report.cancelled.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/invoices/${c.id}`}
                        className="whitespace-nowrap font-medium text-neutral-900 line-through decoration-neutral-400 hover:text-brand-600 dark:text-neutral-100"
                      >
                        {c.invoiceNumber}
                      </Link>
                      {showBusiness && <span className="block text-xs text-neutral-400">{c.business}</span>}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(c.invoiceDate)}</TD>
                    <TD className="max-w-48 truncate">{c.customerName}</TD>
                    <TD className="max-w-64 truncate">{c.cancelReason ?? "—"}</TD>
                    <TD className="text-right tabular-nums text-neutral-500">{formatCurrency(c.grossAmount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle
            title="Input GST (estimate)"
            subtitle={`Costs ${formatCurrency(report.input.costs)} · gateway fees ${formatCurrency(report.input.gatewayFees)}`}
            action={
              <Link href="/money" className="text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                Money in &amp; out →
              </Link>
            }
          />
        </CardHeader>
        {report.costs.length === 0 && report.fees.length === 0 ? (
          <CardBody>
            <p className="text-sm text-neutral-500">
              No input GST recorded in this period. Log costs as <span className="font-medium">money out</span> with their
              GST rate, and record Razorpay payments with their fee, and they&apos;ll show up here.
            </p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Source</TH>
                  <TH>Details</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">GST</TH>
                </tr>
              </THead>
              <TBody>
                {report.costs.map((c) => (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap">{formatDate(c.date)}</TD>
                    <TD>
                      <Badge>Cost</Badge>
                    </TD>
                    <TD>
                      {c.description || c.category.name}
                      {showBusiness && <span className="ml-1.5 text-xs text-neutral-400">{c.business.name}</span>}
                    </TD>
                    <TD className="text-right tabular-nums">{formatCurrency(c.grossAmount)}</TD>
                    <TD className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(c.gstAmount)}</TD>
                  </TR>
                ))}
                {report.fees.map((f) => (
                  <TR key={f.id}>
                    <TD className="whitespace-nowrap">{formatDate(f.paidOn)}</TD>
                    <TD>
                      <Badge tone="brand">{f.gateway ?? "Gateway"} fee</Badge>
                    </TD>
                    <TD>
                      {f.invoice.customerName} · {f.invoice.invoiceNumber}
                    </TD>
                    <TD className="text-right tabular-nums">{formatCurrency(f.feeAmount)}</TD>
                    <TD className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(f.feeGstAmount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Credit notes shown as negatives in the monthly table. */
function negate(t: GstTotals): GstTotals {
  return { ...t, taxable: -t.taxable, cgst: -t.cgst, sgst: -t.sgst, igst: -t.igst, tax: -t.tax, value: -t.value };
}

function FragmentRows({
  label,
  m,
}: {
  label: string;
  m: { b2b: GstTotals; b2c: GstTotals; all: GstTotals; credits: GstTotals; net: GstTotals };
}) {
  return (
    <>
      <TR>
        <TotalsRow label={label} t={m.credits.count ? m.net : m.all} strong />
      </TR>
      {m.b2b.count > 0 && m.b2c.count > 0 && (
        <>
          <TR>
            <TotalsRow label="B2B" t={m.b2b} sub />
          </TR>
          <TR>
            <TotalsRow label="B2C" t={m.b2c} sub />
          </TR>
        </>
      )}
      {m.credits.count > 0 && (
        <TR>
          <TotalsRow label={`Credit notes (${m.credits.count})`} t={negate(m.credits)} sub />
        </TR>
      )}
    </>
  );
}

function CreditNoteTable({
  credits,
  showBusiness,
  cdnrTax,
  cdnurTax,
}: {
  credits: GstCreditLine[];
  showBusiness: boolean;
  cdnrTax: number;
  cdnurTax: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle
          title={
            <span className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-neutral-400" />
              Credit notes · {credits.length}
            </span>
          }
          subtitle={`GSTR-1 table 9B · CDNR (registered) tax ${formatCurrency(cdnrTax)} · CDNUR (unregistered) tax ${formatCurrency(cdnurTax)} · reduces output tax`}
        />
      </CardHeader>
      {credits.length === 0 ? (
        <CardBody>
          <p className="text-sm text-neutral-500">None in this period.</p>
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1080px]">
            <THead>
              <tr>
                <TH>Credit note</TH>
                <TH>Date</TH>
                <TH>Against</TH>
                <TH>Customer</TH>
                <TH>Type</TH>
                <TH className="text-right">Taxable</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">CGST</TH>
                <TH className="text-right">SGST</TH>
                <TH className="text-right">IGST</TH>
                <TH className="text-right">Value</TH>
              </tr>
            </THead>
            <TBody>
              {credits.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <span className="whitespace-nowrap font-medium text-neutral-900 dark:text-neutral-100">{c.number}</span>
                    <span className="block max-w-48 truncate text-xs text-neutral-400">{c.reason}</span>
                    {showBusiness && <span className="block text-xs text-neutral-400">{c.business}</span>}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(c.noteDate)}</TD>
                  <TD className="whitespace-nowrap">
                    {c.invoiceNumber}
                    <span className="block text-xs text-neutral-400">{formatDate(c.invoiceDate)}</span>
                  </TD>
                  <TD className="max-w-48 truncate">
                    {c.customerName}
                    {c.customerGstin && <span className="block font-mono text-xs text-neutral-400">{c.customerGstin}</span>}
                  </TD>
                  <TD>{c.b2b ? <Badge tone="brand">CDNR</Badge> : <Badge>CDNUR</Badge>}</TD>
                  <TD className="text-right tabular-nums">{formatCurrency(c.taxable)}</TD>
                  <TD className="text-right tabular-nums">{c.gstPercent}%</TD>
                  <TD className="text-right tabular-nums">{c.cgst ? formatCurrency(c.cgst) : "—"}</TD>
                  <TD className="text-right tabular-nums">{c.sgst ? formatCurrency(c.sgst) : "—"}</TD>
                  <TD className="text-right tabular-nums">{c.igst ? formatCurrency(c.igst) : "—"}</TD>
                  <TD className="text-right font-medium tabular-nums text-red-600 dark:text-red-400">−{formatCurrency(c.value)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
