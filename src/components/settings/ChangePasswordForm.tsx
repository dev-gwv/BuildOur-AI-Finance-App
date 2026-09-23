"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, useFieldErrors } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { passwordProblem } from "./TeamForms";
import { request } from "./request";

type FieldName = "currentPassword" | "newPassword" | "confirm";

/**
 * Changing the password ends every session for the account (including this
 * one), so after saving the user is sent to sign in with the new password.
 */
export function ChangePasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const { errors, apply, clear } = useFieldErrors<FieldName>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local: Partial<Record<FieldName, string>> = {};
    if (!current) local.currentPassword = "Enter your current password";
    const problem = passwordProblem(next);
    if (problem) local.newPassword = problem;
    if (confirmNext !== next) local.confirm = "The two new passwords don't match";
    if (Object.keys(local).length) return apply(local);

    setPending(true);
    const result = await request("/api/account/password", "POST", { currentPassword: current, newPassword: next });
    if (!result.ok) {
      setPending(false);
      apply(result.fields as Partial<Record<FieldName, string>>);
      return toast.error(result.error);
    }
    setDone(true);
    // Every session — this one too — was ended by the change.
    setTimeout(() => signOut({ redirectTo: "/login" }), 2500);
  }

  if (done) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Password changed. You&apos;re being signed out of every device — sign in again with the new password.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
      <Field label="Current password" error={errors.currentPassword}>
        <Input
          type="password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            clear("currentPassword");
          }}
          autoComplete="current-password"
        />
      </Field>
      <Field label="New password" error={errors.newPassword} hint="At least 10 characters, with letters and numbers.">
        <Input
          type="password"
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            clear("newPassword");
          }}
          autoComplete="new-password"
        />
      </Field>
      <Field label="New password again" error={errors.confirm}>
        <Input
          type="password"
          value={confirmNext}
          onChange={(e) => {
            setConfirmNext(e.target.value);
            clear("confirm");
          }}
          autoComplete="new-password"
        />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" loading={pending}>
          Change password
        </Button>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">You&apos;ll be signed out everywhere afterwards.</p>
      </div>
    </form>
  );
}
