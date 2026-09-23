import Link from "next/link";
import { Compass, Wallet } from "lucide-react";

/** An address that isn't part of the app at all. Rendered without the app shell. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-900/20 ring-1 ring-white/20">
          <Wallet className="h-5 w-5" />
        </span>
        <p className="mt-8 font-mono text-sm font-medium text-brand-600 dark:text-brand-400">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 dark:text-white">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Check the address, or head back to your overview.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-5 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <Compass className="h-4 w-4" />
          Back to Grateful Finance
        </Link>
      </div>
    </main>
  );
}
