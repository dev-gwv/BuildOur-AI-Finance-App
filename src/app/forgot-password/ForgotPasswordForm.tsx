"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, MailCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { AuthError } from "@/app/login/AuthShell";

export function ForgotPasswordForm({ emailEnabled, initialEmail }: { emailEnabled: boolean; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const back = (
    <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
      <ArrowLeft className="h-4 w-4" />
      Back to sign in
    </Link>
  );

  if (!emailEnabled) {
    // No mail server: the only way back in is an admin, who can set a new
    // password in Settings → Team. Say so plainly rather than pretend to send.
    return (
      <div>
        <div className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300">
          <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" />
          <p>
            Ask an admin to reset it: they can set a new password for you in <strong>Settings → Team</strong>. You&apos;ll
            be able to sign in straight away and change it under <strong>Account</strong>.
          </p>
        </div>
        {back}
      </div>
    );
  }

  if (sent) {
    return (
      <div>
        <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{sent} Check your spam folder if it hasn&apos;t arrived in a few minutes.</p>
        </div>
        {back}
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't send the link. Please try again.");
        return;
      }
      setSent(data.message);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Work email">
        <Input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </Field>
      {error && <AuthError>{error}</AuthError>}
      <Button type="submit" loading={pending} disabled={!email.trim()} className="h-11 w-full">
        Email me a reset link
      </Button>
      {back}
    </form>
  );
}
