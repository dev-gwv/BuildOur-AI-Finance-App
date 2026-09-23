"use client";

import { todayISO } from "@/lib/dates";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Hourglass, Landmark } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDate } from "@/lib/format";


export type BajajDisbursement = { amount: number; paidOn: string | Date; feeAmount?: number; gatewayRef?: string | null };

/**
 * A Bajaj Finance sale's payout. Bajaj pays the financed amount into the bank
 * later, less its dealer charges; until then the sale is "awaiting Bajaj".
 * Recording what actually arrived settles the financed amount and books the
 * difference as Bajaj's charges, so "received" and "landed in the bank" both
 * stay true.
 */
export function BajajDisbursementCard({
  invoiceId,
  doId,
  financedAmount,
  outstanding,
  disbursement,
}: {
  invoiceId: string;
  doId: string | null;
  financedAmount: number;
  /** What's still owed on the invoice; Bajaj can't settle more than this. */
  outstanding: number;
  disbursement: BajajDisbursement | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [credited, setCredited] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState("");

  const settles = Math.round(Math.min(financedAmount, outstanding) * 100) / 100;
  const amount = Number(credited) || 0;
  const kept = Math.round((settles - amount) * 100) / 100;
  const keptPct = settles > 0 ? (kept / settles) * 100 : 0;
  const invalid = credited !== "" && (amount <= 0 || amount > settles + 0.005);

  if (disbursement) {
    const fee = disbursement.feeAmount ?? 0;
    const landed = Math.round((disbursement.amount - fee) * 100) / 100;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              Bajaj disbursed {formatCurrency(landed)} on {formatDate(disbursement.paidOn)}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Against {formatCurrency(disbursement.amount)} financed
              {fee > 0 ? ` · Bajaj kept ${formatCurrency(fee)} (${((fee / disbursement.amount) * 100).toFixed(2)}%)` : ""}
              {disbursement.gatewayRef ? ` · ref ${disbursement.gatewayRef}` : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (settles <= 0) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || amount <= 0) return;
    setPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/bajaj-disbursement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credited: amount, paidOn, reference: reference.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't record the disbursement");
        return;
      }
      toast.success(`Bajaj's payout of ${formatCurrency(amount)} recorded`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-500/25 dark:bg-brand-500/[0.07]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-neutral-900 dark:text-brand-300">
            <Hourglass className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              Awaiting Bajaj disbursement · {formatCurrency(settles)}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Financed by Bajaj Finance{doId ? ` · DO ${doId}` : ""}. Record the payout when it reaches the bank — the app
              works out what Bajaj kept.
            </p>
          </div>
        </div>
        {!open && (
          <Button size="sm" variant="brand" onClick={() => setOpen(true)} className="shrink-0">
            <Landmark className="h-3.5 w-3.5" />
            Record disbursement
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 border-t border-brand-100 pt-4 dark:border-brand-500/20">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount credited">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={settles}
                required
                autoFocus
                leading="₹"
                className="tabular-nums"
                value={credited}
                onChange={(e) => setCredited(e.target.value)}
                placeholder={String(settles)}
                invalid={Boolean(invalid)}
              />
            </Field>
            <Field label="Credited on">
              <Input type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="UTR / reference" optional>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the bank statement" className="font-mono placeholder:font-sans" />
            </Field>
          </div>

          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-white p-3 text-sm dark:bg-neutral-950/50">
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Financed</dt>
              <dd className="font-medium tabular-nums text-neutral-900 dark:text-white">{formatCurrency(settles)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Credited</dt>
              <dd className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Bajaj kept</dt>
              <dd className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                {amount > 0 && !invalid ? `${formatCurrency(kept)} · ${keptPct.toFixed(2)}%` : "—"}
              </dd>
            </div>
          </dl>
          {invalid && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Enter what reached the bank — more than zero and at most {formatCurrency(settles)}.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={pending} disabled={invalid || amount <= 0}>
              Save disbursement
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
