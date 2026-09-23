import Link from "next/link";
import { Download, Info, Landmark, Receipt, Users } from "lucide-react";
import { requirePageUser } from "@/server/session";
import { getScope } from "@/server/scope";
import { LIST_PERIODS, parseListPeriod } from "@/components/invoices/listPeriods";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Segmented } from "@/components/ui/Segmented";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import { loadTdsReport } from "./tdsData";

/**
 * TDS receivable: tax B2B customers deducted when paying, which the business
 * claims back against the credit in Form 26AS / AIS. Grouped by deductor so it
 * can be ticked off against that form line by line.
 */
export default async function TdsReportPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await requirePageUser();
  const period = parseListPeriod((await searchParams).period ?? "fy");
  const scope = await getScope(user);
  const report = await loadTdsReport(scope, period);
  const showBusiness = !scope.current;
  const periodLabel = LIST_PERIODS.find((p) => p.key === period)?.label ?? "";

  const exportHref = `/api/export/tds?${new URLSearchParams({
    period,
    ...(scope.current ? { businessId: scope.current.id } : {}),
  }).toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="TDS receivable"
        description={`Tax your customers deducted at source when paying ${scope.current?.name ?? "your businesses"} — claim it against the credit in Form 26AS.`}
        actions={
          report.rows.length > 0 && (
            <a
              href={exportHref}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 sm:h-9 dark:bg-white dark:text-neutral-900"
            >
              <Download className="h-4 w-4" />
              Export to Excel
            </a>
          )
        }
      />

      <Segmented
        items={LIST_PERIODS.map((p) => ({
          key: p.key,
          label: p.label,
          href: { pathname: "/reports/tds", query: p.key === "fy" ? {} : { period: p.key } },
          active: period === p.key,
        }))}
      />

      {report.rows.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={`No TDS recorded ${period === "all" ? "yet" : `in ${periodLabel.toLowerCase()}`}`}
          description="When a B2B customer pays an invoice less TDS, record the payment with the TDS amount and section. It settles the invoice and shows up here."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="TDS withheld" value={formatCurrencyWhole(report.total)} icon={Landmark} hint={periodLabel} />
            <StatCard label="Deductors" value={String(report.groups.length)} icon={Users} hint="customers who deducted TDS" />
            <StatCard label="Payments" value={String(report.rows.length)} icon={Receipt} hint="with TDS deducted" />
          </div>

          <div className="flex gap-2 rounded-xl bg-neutral-100 px-4 py-3 text-sm text-neutral-700 dark:bg-white/[0.05] dark:text-neutral-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Match each deductor below against Form 26AS / AIS on the income-tax portal. A deduction missing there means the
              customer hasn&apos;t filed their TDS return (or quoted the wrong PAN) — ask them for the Form 16A.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="overflow-hidden lg:col-span-2">
              <CardHeader>
                <CardTitle title="By deductor" subtitle="Grouped by the customer's GSTIN, or name when there isn't one" />
              </CardHeader>
              <div className="overflow-x-auto">
                <Table className="min-w-[560px]">
                  <THead>
                    <tr>
                      <TH>Customer</TH>
                      <TH>Sections</TH>
                      <TH className="text-right">Payments</TH>
                      <TH className="text-right">Settled</TH>
                      <TH className="text-right">TDS</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {report.groups.map((g) => (
                      <TR key={g.key}>
                        <TD>
                          <p className="font-medium text-neutral-900 dark:text-neutral-100">{g.customerName}</p>
                          <p className="font-mono text-xs text-neutral-600 dark:text-neutral-400">{g.customerGstin ?? "No GSTIN"}</p>
                        </TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {g.sections.map((sec) => (
                              <Badge key={sec}>{sec}</Badge>
                            ))}
                          </div>
                        </TD>
                        <TD className="text-right tabular-nums">{g.count}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">{formatCurrency(g.settled)}</TD>
                        <TD className="whitespace-nowrap text-right font-semibold tabular-nums text-neutral-900 dark:text-white">
                          {formatCurrency(g.tds)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle title="By section" subtitle="Income Tax Act section deducted under" />
              </CardHeader>
              <CardBody className="space-y-3">
                {report.sections.map((sec) => (
                  <div key={sec.section} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-neutral-700 dark:text-neutral-300">{sec.section === "Other" ? "Other" : `Section ${sec.section}`}</span>
                    <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">{formatCurrency(sec.tds)}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle title="Every deduction" subtitle="Newest first" />
            </CardHeader>
            <div className="overflow-x-auto">
              <Table className="min-w-[760px]">
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Customer</TH>
                    <TH>Invoice</TH>
                    {showBusiness && <TH>Business</TH>}
                    <TH>Section</TH>
                    <TH className="text-right">Settled</TH>
                    <TH className="text-right">TDS</TH>
                  </tr>
                </THead>
                <TBody>
                  {report.rows.map((r) => (
                    <TR key={r.paymentId}>
                      <TD className="whitespace-nowrap">{formatDate(r.paidOn)}</TD>
                      <TD>
                        <p className="font-medium text-neutral-800 dark:text-neutral-200">{r.customerName}</p>
                        {r.customerGstin && <p className="font-mono text-xs text-neutral-600 dark:text-neutral-400">{r.customerGstin}</p>}
                      </TD>
                      <TD>
                        <Link
                          href={`/invoices/${r.invoiceId}`}
                          className="whitespace-nowrap font-medium text-neutral-900 hover:text-brand-600 dark:text-neutral-100 dark:hover:text-brand-400"
                        >
                          {r.invoiceNumber}
                        </Link>
                      </TD>
                      {showBusiness && (
                        <TD>
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.business.color }} />
                            {r.business.name}
                          </span>
                        </TD>
                      )}
                      <TD>
                        <Badge>{r.tdsSection}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{formatCurrency(r.amount)}</TD>
                      <TD className="whitespace-nowrap text-right font-semibold tabular-nums text-neutral-900 dark:text-white">
                        {formatCurrency(r.tdsAmount)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
