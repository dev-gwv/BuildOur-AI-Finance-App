import Link from "next/link";
import { AlertTriangle, ArrowRight, CloudOff, Mail, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { overdueInvoices, syncFailures, type AlertScope } from "@/lib/alerts";
import { formatCurrencyWhole } from "@/lib/format";

type Alert = {
  key: string;
  tone: "danger" | "warning" | "info";
  icon: typeof AlertTriangle;
  text: string;
  href: string;
  cta: string;
};

const TONES: Record<Alert["tone"], string> = {
  danger:
    "border-red-200/80 bg-red-50/80 text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200",
  warning:
    "border-amber-200/80 bg-amber-50/80 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
  info: "border-brand-200/80 bg-brand-50/80 text-brand-900 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200",
};

const ICON_TONES: Record<Alert["tone"], string> = {
  danger: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-brand-600 dark:text-brand-400",
};

/**
 * What needs doing, above the dashboard: businesses set up automatically that
 * an admin should confirm, money that didn't reach a sheet, invoices past due,
 * and invoices changed since they were emailed — all limited to the businesses
 * in view. Nothing renders when all is clear.
 */
export async function AlertsBanner({ scope, isAdmin }: { scope: AlertScope; isAdmin: boolean }) {
  const businessWhere = scope === "ALL" ? {} : { businessId: { in: scope } };
  const [failures, overdue, revised, toReview] = await Promise.all([
    syncFailures(scope),
    overdueInvoices(scope),
    prisma.invoice.findMany({
      where: { revisedAt: { not: null }, emailSentAt: { not: null }, ...businessWhere },
      select: { revisedAt: true, emailSentAt: true },
    }),
    // Setup is an admin's job, so only admins are nudged about it.
    isAdmin ? prisma.business.count({ where: { needsReview: true, archivedAt: null } }) : Promise.resolve(0),
  ]);

  const alerts: Alert[] = [];

  if (toReview > 0) {
    alerts.push({
      key: "review",
      tone: "info",
      icon: Sparkles,
      text: `${toReview} business${toReview === 1 ? " was" : "es were"} set up automatically — check the legal entity, invoice series and sheet for each.`,
      href: "/settings/businesses",
      cta: "Review them",
    });
  }

  if (failures.count > 0) {
    const names = failures.businesses;
    alerts.push({
      key: "sync",
      tone: "danger",
      icon: CloudOff,
      text: `${failures.count} change${failures.count === 1 ? "" : "s"} didn't reach the ${
        names.length ? names.join(", ") : "Google"
      } sheet${names.length > 1 ? "s" : ""}.`,
      href: "/settings/sync",
      cta: "Review & retry",
    });
  }

  if (overdue.count > 0) {
    alerts.push({
      key: "overdue",
      tone: "warning",
      icon: AlertTriangle,
      text: `${overdue.count} invoice${overdue.count === 1 ? " is" : "s are"} past due · ${formatCurrencyWhole(overdue.amount)} outstanding.`,
      href: "/invoices?status=open",
      cta: "See who owes",
    });
  }

  const staleEmails = revised.filter((r) => r.revisedAt! > r.emailSentAt!).length;
  if (staleEmails > 0) {
    alerts.push({
      key: "revised",
      tone: "info",
      icon: Mail,
      text: `${staleEmails} invoice${staleEmails === 1 ? " was" : "s were"} edited after being emailed. The customer still has the old version.`,
      href: "/invoices",
      cta: "Open invoices",
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.key}
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-sm ${TONES[a.tone]}`}
        >
          <a.icon className={`h-4 w-4 shrink-0 ${ICON_TONES[a.tone]}`} />
          <span className="min-w-0 flex-1">{a.text}</span>
          <Link href={a.href} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline">
            {a.cta}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ))}
    </div>
  );
}
