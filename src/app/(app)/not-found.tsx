import Link from "next/link";
import { SearchX } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * A record that doesn't exist — or belongs to a business this person can't
 * see (access checks answer "not found" rather than confirming it exists).
 */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 dark:bg-white/[0.06] dark:text-neutral-400 dark:ring-white/10">
          <SearchX className="h-5 w-5" />
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-tight text-neutral-950 dark:text-white">
          We couldn&apos;t find that
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          It may have been deleted, the link may be wrong, or it belongs to a business you don&apos;t have access to.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/invoices"
            className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Go to invoices
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200"
          >
            Go to overview
          </Link>
        </div>
      </Card>
    </div>
  );
}
