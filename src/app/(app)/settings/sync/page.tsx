import { CheckCircle2, CircleSlash, CloudOff } from "lucide-react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { requirePageAdmin } from "@/server/session";
import { sheetSource } from "@/server/businesses";
import { SyncRetryButton } from "@/components/SyncRetryButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

const ACTION_LABELS: Record<string, string> = {
  upsert: "Write receipt",
  add: "Write receipt",
  remove: "Remove receipt",
  upsertExpense: "Write expense",
  addExpense: "Write expense",
  removeExpense: "Remove expense",
};

function when(date: Date) {
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** What the record looked like when it failed, in words — the payload is what was sent. */
function describe(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const who = (p.client ?? p.particular) as string | undefined;
  const amount = typeof p.amount === "number" ? `₹${p.amount.toLocaleString("en-IN")}` : null;
  return [who, amount, p.date as string | undefined].filter(Boolean).join(" · ") || "—";
}

export default async function SheetSyncPage() {
  await requirePageAdmin();

  const [pending, resolved, businesses] = await Promise.all([
    prisma.sheetSyncFailure.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.sheetSyncFailure.findMany({
      where: { resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: 10,
    }),
    prisma.business.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true, slug: true, sheetUrl: true, sheetSecretEnc: true },
    }),
  ]);

  // Only whether each is connected — the URL and secret themselves never leave the server.
  const nameOf = new Map(businesses.map((b) => [b.id, b.name]));
  const workbooks = businesses.map((b) => ({
    id: b.id,
    label: b.name,
    color: b.color,
    source: sheetSource(b),
    pending: pending.filter((f) => f.businessId === b.id).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Sheet sync"
        description="Every payment and money in/out entry is written to its business's Google Sheet. Anything that didn't get through waits here to be retried."
        actions={pending.length > 1 ? <SyncRetryButton label={`Retry all ${pending.length}`} /> : undefined}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {workbooks.map((w) => (
          <Card key={w.id} className="px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
                <span className="h-2 w-2 rounded-full" style={{ background: w.color }} />
                {w.label}
              </p>
              {!w.source ? (
                <Badge dot>Not connected</Badge>
              ) : w.pending > 0 ? (
                <Badge tone="danger" dot>
                  {w.pending} pending
                </Badge>
              ) : (
                <Badge tone="success" dot>
                  In sync
                </Badge>
              )}
            </div>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              {w.source === "settings"
                ? "Connected — new records are written as they're saved."
                : w.source === "environment"
                  ? "Connected through environment variables. "
                  : "Not connected yet. "}
              {w.source !== "settings" && (
                <Link href={`/settings/businesses/${w.id}#sheet`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {w.source ? "Manage it in the app →" : "Connect its sheet →"}
                </Link>
              )}
            </p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle
            title="Waiting to be retried"
            subtitle="Retrying is always safe: a record's row is rewritten in place, never duplicated"
          />
        </CardHeader>
        {pending.length === 0 ? (
          <CardBody>
            <EmptyState icon={CheckCircle2} title="Nothing pending" description="Every change has reached its sheet." />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Sheet</TH>
                  <TH>Change</TH>
                  <TH>Record</TH>
                  <TH className="text-right">Tries</TH>
                  <TH>Error</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {pending.map((f) => {
                  return (
                    <TR key={f.id}>
                      <TD className="whitespace-nowrap">{when(f.createdAt)}</TD>
                      <TD className="font-medium text-neutral-900 dark:text-neutral-100">
                        {nameOf.get(f.businessId) ?? "Removed business"}
                      </TD>
                      <TD>
                        <Badge tone={f.action.startsWith("remove") ? "neutral" : "brand"}>
                          {ACTION_LABELS[f.action] ?? f.action}
                        </Badge>
                      </TD>
                      <TD className="max-w-56 truncate">{describe(f.payload)}</TD>
                      <TD className="text-right tabular-nums">{f.attempts}</TD>
                      <TD className="max-w-72">
                        <span className="line-clamp-2 font-mono text-xs text-red-700 dark:text-red-400" title={f.error}>
                          {f.error}
                        </span>
                      </TD>
                      <TD className="text-right">
                        <SyncRetryButton failureId={f.id} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle title="Recently fixed" subtitle="The last 10 writes that failed and later went through" />
        </CardHeader>
        {resolved.length === 0 ? (
          <CardBody>
            <p className="flex items-center gap-2 text-sm text-neutral-500">
              <CircleSlash className="h-4 w-4" />
              No failures so far.
            </p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>Failed</TH>
                  <TH>Fixed</TH>
                  <TH>Sheet</TH>
                  <TH>Record</TH>
                  <TH className="text-right">Tries</TH>
                </tr>
              </THead>
              <TBody>
                {resolved.map((f) => {
                  return (
                    <TR key={f.id}>
                      <TD className="whitespace-nowrap">{when(f.createdAt)}</TD>
                      <TD className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">{when(f.resolvedAt!)}</TD>
                      <TD>{nameOf.get(f.businessId) ?? "Removed business"}</TD>
                      <TD className="max-w-64 truncate">{describe(f.payload)}</TD>
                      <TD className="text-right tabular-nums">{f.attempts}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <p className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Sync is one-way: the app writes into the sheets. Changes typed directly into a sheet don&apos;t come back into the
        app.
      </p>
    </div>
  );
}
