import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { getScope, scopeWhere } from "@/server/scope";
import { InvoiceList, listedInvoiceSelect, parseStatusFilter } from "@/components/InvoiceList";
import { LIST_PERIODS, parseListPeriod, periodFilter } from "@/components/invoices/listPeriods";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Prisma } from "@/generated/prisma/client";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; period?: string }>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const status = parseStatusFilter(params.status);
  const period = parseListPeriod(params.period);
  const q = (params.q ?? "").trim().slice(0, 100);

  const scope = await getScope(user);
  const dates = periodFilter(period);
  const where: Prisma.InvoiceWhereInput = {
    ...scopeWhere(scope),
    ...(dates ? { invoiceDate: dates } : {}),
    ...(q
      ? {
          OR: [
            { customerName: { contains: q, mode: "insensitive" } },
            { invoiceNumber: { contains: q, mode: "insensitive" } },
            { customerGstin: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    select: listedInvoiceSelect,
    take: 500,
  });

  const title = scope.current?.name ?? "All businesses";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Invoices"
        title={
          <span className="flex items-center gap-2.5">
            {scope.current && <span className="h-2.5 w-2.5 rounded-full" style={{ background: scope.current.color }} />}
            {title}
          </span>
        }
        description={
          scope.current
            ? `Invoices raised by ${scope.current.name}, numbered ${scope.current.invoicePrefix}…`
            : "Invoices across every business you have access to. Pick a business in the sidebar to focus on one."
        }
        actions={
          <Link
            href="/invoices/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" />
            New invoice
          </Link>
        }
      />
      <InvoiceList
        invoices={invoices}
        filters={{ status, q, period }}
        periods={LIST_PERIODS}
        showBusiness={!scope.current}
        newHref="/invoices/new"
      />
    </div>
  );
}
