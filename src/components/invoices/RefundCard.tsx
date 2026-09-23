"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, useFieldErrors } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/format";
import { todayISO } from "@/lib/dates";

/**
 * Shown when a credit note has left an invoice overpaid: how much goes back to
 * the customer, and a short form to record it once it's been paid out.
 */
export function RefundCard({ invoiceId, toRefund }: { invoiceId: string; toRefund: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { errors, apply, clear } = useFieldErrors<"amount" | "paidOn" | "method" | "note">();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/payments/refund`, { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        apply(data.fields);
        toast.error(data.error ?? "Couldn't record the refund");
        return;
      }
      toast.success(`Refund of ${formatCurrency(data.payment.amount)} recorded`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — the refund wasn't recorded. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 shadow-card dark:bg-neutral-900 dark:text-amber-400">
            <Undo2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {formatCurrency(toRefund)} to refund to the customer
            </p>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
              A credit note reduced this invoice below what&apos;s already been paid. Record the refund once it&apos;s sent.
            </p>
          </div>
        </div>
        {!open && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Record refund
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 border-t border-amber-200/80 pt-4 sm:grid-cols-2 dark:border-amber-500/20">
          <Field label="Amount refunded (₹)" error={errors.amount}>
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={toRefund}
              defaultValue={toRefund}
              required
              onChange={() => clear("amount")}
            />
          </Field>
          <Field label="Refunded on" error={errors.paidOn}>
            <Input name="paidOn" type="date" defaultValue={todayISO()} required onChange={() => clear("paidOn")} />
          </Field>
          <Field label="How" optional error={errors.method}>
            <Input name="method" placeholder="UPI, bank transfer, cash…" />
          </Field>
          <Field label="Reference" optional error={errors.note}>
            <Input name="note" placeholder="UTR / UPI reference" />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" loading={pending}>
              Save refund
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
