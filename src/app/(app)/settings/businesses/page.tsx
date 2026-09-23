import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, Plus, Sheet } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageAdmin } from "@/server/session";
import { previewInvoiceNumber, sheetSource } from "@/server/businesses";
import { entityName } from "@/components/settings/entities";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

export default async function BusinessesPage() {
  await requirePageAdmin();

  const businesses = await prisma.business.findMany({
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    include: { _count: { select: { members: true, invoices: true } } },
  });
  const toReview = businesses.filter((b) => b.needsReview && !b.archivedAt);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Businesses"
        description="Each business has its own invoice series, Google Sheet, categories, gateways and team access."
        actions={
          <Link
            href="/settings/businesses/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" />
            New business
          </Link>
        }
      />

      {toReview.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {toReview.length === 1 ? "1 business was" : `${toReview.length} businesses were`} set up automatically when the app
              was upgraded.
            </p>
            <p className="mt-0.5 text-amber-900 dark:text-amber-200">
              Check each one&apos;s legal entity, invoice series and sheet, then mark it as reviewed:{" "}
              {toReview.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ", "}
                  <Link href={`/settings/businesses/${b.id}`} className="font-medium underline underline-offset-2">
                    {b.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      )}

      {businesses.length === 0 ? (
        <EmptyState icon={Building2} title="No businesses yet" description="Create the first one to start invoicing." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[680px]">
              <THead>
                <tr>
                  <TH>Business</TH>
                  <TH>Bills as</TH>
                  <TH>Next invoice</TH>
                  <TH>Google Sheet</TH>
                  <TH className="hidden text-right xl:table-cell">Invoices</TH>
                  <TH className="hidden text-right xl:table-cell">Members</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {businesses.map((b) => {
                  const sheet = sheetSource(b);
                  return (
                    <TR key={b.id} className={b.archivedAt ? "opacity-60" : ""}>
                      <TD>
                        <Link href={`/settings/businesses/${b.id}`} className="group flex items-start gap-2.5">
                          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium text-neutral-900 group-hover:text-brand-600 dark:text-neutral-100 dark:group-hover:text-brand-400">
                                {b.name}
                              </span>
                              {b.needsReview && !b.archivedAt && <Badge tone="warning">Review</Badge>}
                              {b.archivedAt && <Badge>Archived</Badge>}
                            </span>
                            <span className="mt-0.5 block font-mono text-xs text-neutral-400">/{b.slug}</span>
                          </span>
                        </Link>
                      </TD>
                      <TD className="max-w-[16rem]">{entityName(b.entity)}</TD>
                      <TD className="whitespace-nowrap font-mono text-xs">{previewInvoiceNumber(b)}</TD>
                      <TD className="whitespace-nowrap">
                        {sheet === "settings" ? (
                          <Badge tone="success" dot>
                            Connected
                          </Badge>
                        ) : sheet === "environment" ? (
                          <Badge tone="success" dot>
                            Connected (older setup)
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                            <Sheet className="h-3.5 w-3.5" />
                            Not connected
                          </span>
                        )}
                      </TD>
                      <TD className="hidden text-right tabular-nums xl:table-cell">{b._count.invoices}</TD>
                      <TD className="hidden text-right tabular-nums xl:table-cell">{b._count.members}</TD>
                      <TD className="text-right">
                        <Link
                          href={`/settings/businesses/${b.id}`}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
                        >
                          Manage <ArrowRight className="h-3 w-3" />
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
