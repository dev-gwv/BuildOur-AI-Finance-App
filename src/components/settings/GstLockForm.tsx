"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { request } from "./request";

const pretty = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Last day of the previous month, the usual "filed through" after a monthly return. */
function lastMonthEnd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
}

/**
 * "GST filed through": once a month's return is filed, nothing dated in it can
 * change. Moving the date later is routine; moving it earlier (or removing
 * it) re-opens filed months, so that asks for confirmation and is flagged in
 * the audit log.
 */
export function GstLockForm({ businessId, lockedThrough }: { businessId: string; lockedThrough: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(lockedThrough ?? "");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const reopening = Boolean(lockedThrough && (date === "" || date < lockedThrough));
  const unchanged = date === (lockedThrough ?? "");

  async function save() {
    setPending(true);
    const result = await request(`/api/businesses/${businessId}`, "PATCH", { gstLockedThrough: date });
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(date ? `Locked through ${pretty(date)}` : "Lock removed");
    router.refresh();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (reopening) setConfirming(true);
    else void save();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div
        className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
          lockedThrough
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
            : "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300"
        }`}
      >
        {lockedThrough ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <LockOpen className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>
          {lockedThrough ? (
            <>
              GST is filed through <strong>{pretty(lockedThrough)}</strong>. Invoices, credit notes and entries dated on or before it
              can&apos;t be added, changed or removed — correct a mistake with a credit note dated today.
            </>
          ) : (
            <>No period is locked yet. After you file a GST return, lock the month so its figures can&apos;t change afterwards.</>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
        <Field label="GST filed through" hint="Usually the last day of the month you just filed.">
          <Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2 sm:pb-6">
          {!lockedThrough && (
            <Button type="button" variant="secondary" onClick={() => setDate(lastMonthEnd())}>
              Last month
            </Button>
          )}
          {lockedThrough && (
            <Button type="button" variant="ghost" onClick={() => setDate("")}>
              Remove lock
            </Button>
          )}
        </div>
      </div>

      {reopening && (
        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          This re-opens months whose GST is already filed. Only do it to fix a mistake before re-filing.
        </p>
      )}

      <div>
        <Button type="submit" loading={pending} disabled={unchanged}>
          {date ? "Save lock" : "Remove lock"}
        </Button>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        dismissible={!pending}
        size="sm"
        title="Re-open filed months?"
        description={
          date
            ? `Records from ${pretty(date)} to ${pretty(lockedThrough!)} become editable again.`
            : `Everything up to ${pretty(lockedThrough!)} becomes editable again.`
        }
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Keep it locked
            </Button>
            <Button type="button" variant="danger" loading={pending} onClick={() => void save()}>
              Re-open
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Changes to a filed period have to be reported in your next return. This is recorded in the audit log.
        </p>
      </Modal>
    </form>
  );
}
