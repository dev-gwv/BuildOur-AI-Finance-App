"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { passwordProblem } from "./TeamForms";
import { hintClass, inputClass, labelClass, request } from "./request";

/**
 * Changing the password ends every session for the account (including this
 * one), so after saving the user is sent to sign in with the new password.
 */
export function ChangePasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [fields, setFields] = useState<Record<string, string>>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const problem = next ? passwordProblem(next) : null;
  const mismatch = confirmNext && confirmNext !== next ? "The two new passwords don't match" : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (problem || mismatch) return;
    setPending(true);
    setFields(undefined);
    const result = await request("/api/account/password", "POST", { currentPassword: current, newPassword: next });
    if (!result.ok) {
      setPending(false);
      setFields(result.fields);
      return toast.error(result.error);
    }
    setDone(true);
    // Every session — this one too — was ended by the change.
    setTimeout(() => signOut({ redirectTo: "/login" }), 2500);
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Password changed. You&apos;re being signed out of every device — sign in again with the new password.</p>
      </div>
    );
  }

  const err = (name: string) => fields?.[name] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fields[name]}</p>;

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      <label className={labelClass}>
        Current password
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className={inputClass}
        />
        {err("currentPassword")}
      </label>
      <label className={labelClass}>
        New password
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          autoComplete="new-password"
          className={inputClass}
        />
        <p className={problem ? "mt-1 text-xs text-amber-700 dark:text-amber-400" : hintClass}>
          {problem ?? "At least 10 characters, with letters and numbers."}
        </p>
        {err("newPassword")}
      </label>
      <label className={labelClass}>
        New password again
        <input
          type="password"
          value={confirmNext}
          onChange={(e) => setConfirmNext(e.target.value)}
          required
          autoComplete="new-password"
          className={inputClass}
        />
        {mismatch && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{mismatch}</p>}
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending} disabled={!current || !next || Boolean(problem) || Boolean(mismatch) || confirmNext !== next}>
          Change password
        </Button>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">You&apos;ll be signed out everywhere afterwards.</p>
      </div>
    </form>
  );
}
