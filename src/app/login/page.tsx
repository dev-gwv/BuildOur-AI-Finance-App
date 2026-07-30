"use client";

import { useActionState } from "react";
import { AlertCircle, TrendingUp, Wallet } from "lucide-react";
import { loginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-neutral-950 p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.5), transparent 45%), radial-gradient(circle at 80% 70%, rgba(16,185,129,0.35), transparent 45%)",
          }}
        />
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <Wallet className="h-5 w-5" />
          </span>
          BuildOur Finance
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
            Every rupee accounted for, across every company you run.
          </h2>
          <p className="text-neutral-300">
            Track expenses, payment gateway charges, and GST breakups with a live P&amp;L
            dashboard — no more scattered screenshots and spreadsheets.
          </p>
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <TrendingUp className="h-4 w-4" />
            Real-time revenue breakup, per company
          </div>
        </div>
        <p className="relative text-xs text-neutral-500">© {new Date().getFullYear()} BuildOur</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-neutral-900 lg:hidden dark:text-neutral-100">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Wallet className="h-5 w-5" />
            </span>
            BuildOur Finance
          </div>

          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Welcome back</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Sign in to manage your companies&apos; expenses and P&amp;L.
          </p>

          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" loading={pending} className="w-full">
              {pending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
