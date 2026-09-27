"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { request } from "./request";

/**
 * "Sends invoices from": the one-time choice of mailbox for a business. Kept
 * per business (not per send) so a business's invoices always come from the
 * same address and customers' replies land in the right inbox.
 */
export function BusinessMailboxForm({
  businessId,
  current,
  mailboxes,
  defaultEmail,
}: {
  businessId: string;
  current: string | null;
  mailboxes: { id: string; label: string; email: string; isDefault: boolean }[];
  /** What "use the default" resolves to today, for the hint. */
  defaultEmail: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value !== (current ?? "");

  async function save() {
    setSaving(true);
    const res = await request(`/api/businesses/${businessId}`, "PATCH", { mailAccountId: value });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    const chosen = mailboxes.find((m) => m.id === value);
    toast.success(`Invoices will be sent from ${chosen?.email ?? defaultEmail ?? "the default mailbox"}`);
    router.refresh();
  }

  if (mailboxes.length === 0) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {defaultEmail ? (
          <>
            Invoices go from <strong className="text-neutral-900 dark:text-neutral-100">{defaultEmail}</strong> (the SMTP settings in
            Vercel).{" "}
          </>
        ) : (
          "No mailbox is set up, so invoices can't be emailed yet. "
        )}
        <Link href="/settings/integrations" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Add mailboxes in Integrations
        </Link>{" "}
        to give each business its own.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field
        className="min-w-0 flex-1"
        label="Sends invoices from"
        hint="Customers see this address and their replies land in its inbox. Admins can still pick another mailbox for a one-off send."
      >
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Default mailbox{defaultEmail ? ` (${defaultEmail})` : ""}</option>
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.email} — {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button onClick={save} loading={saving} disabled={!dirty} className="sm:mb-[1.625rem]">
        Save
      </Button>
    </div>
  );
}
