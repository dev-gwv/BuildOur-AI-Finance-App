"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, useFieldErrors } from "@/components/ui/Field";
import { AuthError } from "@/app/login/AuthShell";

/** Mirrors the server's password rule, so mistakes show before a round trip. */
function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters";
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return "Use both letters and numbers";
  return null;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, apply, clear } = useFieldErrors<"password" | "confirm">();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem || password !== confirm) {
      apply({ ...(problem ? { password: problem } : {}), ...(password !== confirm ? { confirm: "The two passwords don't match" } : {}) });
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth-reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields?.password) apply({ password: data.fields.password });
        else setError(data.error ?? "Couldn't change the password. Please try again.");
        return;
      }
      router.replace("/login?reset=done");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="New password" error={errors.password} hint="At least 10 characters, with letters and numbers.">
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clear("password");
          }}
        />
      </Field>
      <Field label="Type it again" error={errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            clear("confirm");
          }}
        />
      </Field>
      {error && <AuthError>{error}</AuthError>}
      <Button type="submit" loading={pending} className="h-11 w-full">
        Set new password
      </Button>
    </form>
  );
}
