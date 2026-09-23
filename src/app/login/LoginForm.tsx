"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { loginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { AuthError, AuthShell } from "./AuthShell";

/** The sign-in form. `next` is where to go afterwards (validated again on the server). */
export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [error, formAction, pending] = useActionState(loginAction, undefined);
  // Held in state because React resets a form's fields after its action runs:
  // without this a wrong password would also wipe the email, and the retry
  // would silently fail the browser's "required" check.
  const [email, setEmail] = useState("");

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your finance workspace.">
      {notice && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {notice}
        </p>
      )}
      <form action={formAction} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Password
            </label>
            <Link
              href={email ? `/forgot-password?email=${encodeURIComponent(email)}` : "/forgot-password"}
              className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoFocus={Boolean(error)}
            autoComplete="current-password"
            placeholder="••••••••"
            invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>

        {error && (
          <div id="login-error">
            <AuthError>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </AuthError>
          </div>
        )}

        <Button type="submit" loading={pending} className="h-11 w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
