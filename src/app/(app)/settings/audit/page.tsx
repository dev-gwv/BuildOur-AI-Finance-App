import Link from "next/link";
import { History, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageAdmin } from "@/server/session";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const PAGE_SIZE = 50;

const ENTITY_LABELS: Record<string, string> = {
  invoice: "Invoices",
  payment: "Payments",
  entry: "Money in & out",
  expense: "Money in & out",
  business: "Businesses",
  user: "Team",
  settings: "Settings",
  integration: "Integrations",
};

/** "invoice.update" -> tone + word, so creations, edits and deletions read apart at a glance. */
function verb(action: string): { label: string; tone: "success" | "warning" | "danger" | "neutral" | "brand" } {
  const v = action.split(".").pop() ?? action;
  if (v === "create" || v === "add") return { label: "Created", tone: "success" };
  if (v === "delete" || v === "remove") return { label: "Deleted", tone: "danger" };
  if (v === "update" || v === "edit") return { label: "Edited", tone: "warning" };
  return { label: v.charAt(0).toUpperCase() + v.slice(1).replace(/[-_]/g, " "), tone: "brand" };
}

function when(date: Date) {
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; type?: string; user?: string; q?: string; cursor?: string }>;
}) {
  await requirePageAdmin();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const where: Prisma.AuditLogWhereInput = {
    ...(params.business ? { businessId: params.business } : {}),
    ...(params.type ? { entityType: params.type } : {}),
    ...(params.user ? { userId: params.user } : {}),
    ...(q ? { summary: { contains: q, mode: "insensitive" } } : {}),
  };

  const [rows, businesses, users, types] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: { user: { select: { name: true } } },
    }),
    prisma.business.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const filtered = Boolean(params.business || params.type || params.user || q);

  const nextHref = {
    pathname: "/settings/audit",
    query: {
      ...(params.business ? { business: params.business } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.user ? { user: params.user } : {}),
      ...(q ? { q } : {}),
      cursor: page[page.length - 1]?.id,
    },
  };

  const selectClass =
    "h-9 rounded-lg border border-neutral-200/80 bg-white px-2.5 text-sm shadow-card dark:border-white/10 dark:bg-neutral-900/70";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Audit log"
        description="Every invoice, payment, entry, business and team change: who made it, when, and what it changed."
      />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <select name="business" defaultValue={params.business ?? ""} className={selectClass} aria-label="Business">
          <option value="">All businesses</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={params.type ?? ""} className={selectClass} aria-label="Record type">
          <option value="">Everything</option>
          {types.map(({ entityType }) => (
            <option key={entityType} value={entityType}>
              {ENTITY_LABELS[entityType] ?? entityType}
            </option>
          ))}
        </select>
        <select name="user" defaultValue={params.user ?? ""} className={selectClass} aria-label="Person">
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search what changed…"
            className="h-9 w-64 rounded-lg border border-neutral-200/80 bg-white pl-9 pr-3 text-sm shadow-card outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-900/70"
          />
        </div>
        <button className="h-9 rounded-lg bg-neutral-900 px-3.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
          Filter
        </button>
        {filtered && (
          <Link href="/settings/audit" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            Clear
          </Link>
        )}
      </form>

      {page.length === 0 ? (
        <EmptyState
          icon={History}
          title={filtered ? "Nothing matches these filters" : "No changes recorded yet"}
          description={filtered ? undefined : "Changes to invoices, payments, entries, businesses and the team will be listed here."}
        />
      ) : (
        <Card className="overflow-hidden">
          <ol className="divide-y divide-neutral-100 dark:divide-white/[0.05]">
            {page.map((row) => {
              const v = verb(row.action);
              const business = row.businessId ? businessById.get(row.businessId) : null;
              const changes = (row.changes ?? null) as Record<string, { from: unknown; to: unknown }> | null;
              const changeKeys = changes ? Object.keys(changes) : [];
              return (
                <li key={row.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={v.tone}>{v.label}</Badge>
                        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                          {ENTITY_LABELS[row.entityType] ?? row.entityType}
                        </span>
                        {business && (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: business.color }} />
                            {business.name}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">{row.summary}</p>
                    </div>
                    <div className="text-right text-xs text-neutral-500">
                      <p className="font-medium text-neutral-700 dark:text-neutral-300">{row.user?.name ?? "System"}</p>
                      <p className="whitespace-nowrap">{when(row.createdAt)}</p>
                    </div>
                  </div>
                  {changeKeys.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-brand-600 hover:text-brand-500 dark:text-brand-400">
                        {changeKeys.length} field{changeKeys.length === 1 ? "" : "s"} changed
                      </summary>
                      <table className="mt-2 w-full max-w-2xl">
                        <tbody>
                          {changeKeys.map((key) => (
                            <tr key={key} className="border-t border-neutral-100 dark:border-white/[0.05]">
                              <td className="py-1.5 pr-4 font-medium text-neutral-600 dark:text-neutral-300">{key}</td>
                              <td className="py-1.5 pr-4 text-red-700 line-through decoration-red-300 dark:text-red-400">
                                {show(changes![key].from)}
                              </td>
                              <td className="py-1.5 text-emerald-700 dark:text-emerald-400">{show(changes![key].to)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
          {hasMore && (
            <div className="border-t border-neutral-100 px-5 py-3 text-center dark:border-white/[0.05]">
              <Link href={nextHref} className="text-sm font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                Older changes →
              </Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
