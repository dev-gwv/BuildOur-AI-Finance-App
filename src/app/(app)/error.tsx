"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * A page that failed to load, inside the app shell so the rest of the app
 * stays usable. Never shows the error itself — only a reference to quote.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-tight text-neutral-950 dark:text-white">
          This page couldn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Something went wrong on our side. Your data is safe — trying again usually fixes it.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-neutral-400">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => unstable_retry()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
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
