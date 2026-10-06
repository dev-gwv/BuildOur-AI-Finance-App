"use client";

import { todayISO } from "@/lib/dates";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Hourglass, Landmark } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { expectedBajajDeduction, type DoDetails } from "@/lib/bajajDo";

export type BajajDisbursement = { amount: number; paidOn: string | Date; feeAmount?: number; feeGstAmount?: number; gatewayRef?: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Bajaj's payout carries 18% GST inside it, reckoned on the net disbursement. */
const GST = 0.18;

/**
 * A Bajaj Finance sale's payout. Bajaj pays the net loan into the bank later,
 * less the dealer subsidy and its own charges; until then the sale is
 * "awaiting Bajaj". The amount paid by customer is the DO's net loan (what
 * settles the invoice), the amount credited its net disbursement (what reached
 * the bank); the difference is booked as what Bajaj kept.
 */
export function BajajDisbursementCard({
  invoiceId,
  doId,
  financedAmount,
  outstanding,
  disbursement,
  doDetails,
}: {
  invoiceId: string;
  doId: string | null;
  financedAmount: number;
  /** What's still owed on the invoice; Bajaj can't settle more than this. */
  outstanding: number;
  disbursement: BajajDisbursement | null;
  /** The DO's figures, when it was read from one. */
  doDetails?: DoDetails | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const maxSettle = round2(Math.min(financedAmount, outstanding));
  const defaultLoan = round2(Math.min(doDetails?.netLoanAmount ?? financedAmount, maxSettle));
  const [loan, setLoan] = useState(defaultLoan > 0 ? String(defaultLoan) : "");
  const [credited, setCredited] = useState(doDetails?.netDisbursement != null ? String(doDetails.netDisbursement) : "");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState("");

  const settles = Number(loan) || 0;
  const amount = Number(credited) || 0;
  const kept = round2(settles - amount);
  const keptPct = settles > 0 ? (kept / settles) * 100 : 0;
  const loanInvalid = loan !== "" && (settles <= 0 || settles > maxSettle + 0.005);
  const creditedInvalid = credited !== "" && (amount <= 0 || amount > settles + 0.005);
  const invalid = loanInvalid || creditedInvalid;
  const gstInside = round2(amount - amount / (1 + GST));
  const expected = expectedBajajDeduction(doDetails ?? null);
  const offFromDo = expected != null && amount > 0 && !invalid && Math.abs(kept - expected) > 1;

  if (disbursement) {
    const fee = (disbursement.feeAmount ?? 0) + (disbursement.feeGstAmount ?? 0);
    const landed = round2(disbursement.amount - fee);
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              Bajaj disbursed {formatCurrency(landed)} on {formatDate(disbursement.paidOn)}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Against {formatCurrency(disbursement.amount)} net loan
              {fee > 0 ? ` · Bajaj kept ${formatCurrency(fee)} (${((fee / disbursement.amount) * 100).toFixed(2)}%)` : ""}
              {` · excl. 18% GST ${formatCurrency(round2(landed / (1 + GST)))}`}
              {disbursement.gatewayRef ? ` · ref ${disbursement.gatewayRef}` : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (maxSettle <= 0) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || amount <= 0 || settles <= 0) return;
    setPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/bajaj-disbursement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: settles, credited: amount, paidOn, reference: reference.trim() || undefined }),
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
              Awaiting Bajaj disbursement · {formatCurrency(defaultLoan)}
              {doDetails?.netDisbursement != null && (
                <span className="font-normal text-neutral-600 dark:text-neutral-400"> · {formatCurrency(doDetails.netDisbursement)} expected in the bank</span>
              )}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Amount paid by customer"
              hint={doDetails?.netLoanAmount != null ? "The DO's net loan amount (row C)" : "What Bajaj financed"}
              error={loanInvalid ? `More than zero and at most ${formatCurrency(maxSettle)}` : null}
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={maxSettle}
                required
                leading="₹"
                className="tabular-nums"
                value={loan}
                onChange={(e) => setLoan(e.target.value)}
                invalid={loanInvalid}
              />
            </Field>
            <Field
              label="Amount credited"
              hint={doDetails?.netDisbursement != null ? "The DO's net disbursement (row AA) — change it if the bank got a different amount" : "What reached the bank"}
              error={creditedInvalid ? `More than zero and at most ${formatCurrency(settles)}` : null}
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={settles || undefined}
                required
                autoFocus
                leading="₹"
                className="tabular-nums"
                value={credited}
                onChange={(e) => setCredited(e.target.value)}
                invalid={creditedInvalid}
              />
            </Field>
            <Field label="Credited on">
              <Input type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="UTR / reference" optional>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the bank statement" className="font-mono placeholder:font-sans" />
            </Field>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-white p-3 text-sm sm:grid-cols-4 dark:bg-neutral-950/50">
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Bajaj kept</dt>
              <dd className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                {amount > 0 && !invalid ? `${formatCurrency(kept)} · ${keptPct.toFixed(2)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Credited</dt>
              <dd className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">GST 18% inside it</dt>
              <dd className="font-medium tabular-nums text-amber-700 dark:text-amber-400">{amount > 0 ? `−${formatCurrency(gstInside)}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Credited excl. GST</dt>
              <dd className="font-medium tabular-nums text-neutral-900 dark:text-white">{amount > 0 ? formatCurrency(round2(amount - gstInside)) : "—"}</dd>
            </div>
          </dl>
          {offFromDo && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The DO says Bajaj keeps {formatCurrency(expected!)}; this records {formatCurrency(kept)}. Check the amount against the bank
              statement before saving.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={pending} disabled={invalid || amount <= 0 || settles <= 0}>
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
