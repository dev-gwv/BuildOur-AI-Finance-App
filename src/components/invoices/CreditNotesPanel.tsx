"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Lock, Plus, Trash2, Undo2 } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, useFieldErrors } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export type PanelCreditNote = {
  id: string;
  number: string;
  noteDate: string;
  reason: string;
  grossAmount: number;
  gstPercent: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
};

const REASONS = ["Price correction", "Discount after sale", "Goods or service returned", "Other"] as const;
const RATES = [0, 5, 12, 18, 28];

type FieldName = "noteDate" | "reason" | "grossAmount" | "gstPercent";

/**
 * Credit notes against one invoice: the list, and issuing a new one with a
 * live tax preview on the invoice's own supply type (CGST+SGST or IGST).
 */
export function CreditNotesPanel({
  invoiceId,
  invoiceNumber,
  invoiceDate,
  creditNotes,
  net,
  toRefund,
  gstRegistered,
  interState,
  defaultRate,
  lockedThrough,
  canDelete,
  cancelled,
}: {
  invoiceId: string;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  creditNotes: PanelCreditNote[];
  /** What's still creditable: invoice total − credit notes so far. */
  net: number;
  toRefund: number;
  gstRegistered: boolean;
  interState: boolean;
  defaultRate: number;
  /** YYYY-MM-DD the business's GST is filed through, if any. */
  lockedThrough: string | null;
  canDelete: boolean;
  cancelled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { errors, apply, clear } = useFieldErrors<FieldName>();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<(typeof REASONS)[number]>("Price correction");
  const [otherReason, setOtherReason] = useState("");
  const [noteDate, setNoteDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(String(defaultRate));

  const gross = Number(amount) || 0;
  const preview = calculateInvoiceBreakup({
    grossAmount: gross,
    gstPercent: gstRegistered ? Number(rate) || 0 : 0,
    qty: 1,
    isInterState: interState,
  });
  const tooMuch = gross > net + 0.005;
  const dateLocked = Boolean(lockedThrough && noteDate <= lockedThrough);
  const minDate = lockedThrough && lockedThrough >= invoiceDate ? nextDay(lockedThrough) : invoiceDate;

  function reset() {
    setPreset("Price correction");
    setOtherReason("");
    setNoteDate(todayISO());
    setAmount("");
    setRate(String(defaultRate));
    clear();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const reason = preset === "Other" ? otherReason.trim() : otherReason.trim() ? `${preset}: ${otherReason.trim()}` : preset;
    if (preset === "Other" && !reason) {
      apply({ reason: "Say why the invoice is being reduced" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/credit-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteDate, reason, grossAmount: gross, ...(gstRegistered ? { gstPercent: Number(rate) } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        apply(data.fields);
        if (!data.fields) toast.error(data.error ?? "Couldn't issue the credit note");
        return;
      }
      toast.success(`Credit note ${data.creditNote.number} issued for ${formatCurrency(data.creditNote.grossAmount)}`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function remove(cn: PanelCreditNote) {
    const ok = await confirm({
      title: `Delete credit note ${cn.number}?`,
      description: "Only do this for a credit note issued by mistake. Its number isn't reused.",
      confirmLabel: "Delete credit note",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/credit-notes/${cn.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't delete the credit note");
      return;
    }
    toast.success(`Credit note ${cn.number} deleted`);
    router.refresh();
  }

  // Nothing to show on a cancelled invoice with no notes, or on a fresh one with none yet — only the action.
  const canIssue = !cancelled && net > 0.5;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle
          title={
            <span className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-neutral-500" />
              Credit notes
              {creditNotes.length > 0 && <Badge>{creditNotes.length}</Badge>}
            </span>
          }
          subtitle={
            creditNotes.length
              ? `${formatCurrency(creditNotes.reduce((s, c) => s + c.grossAmount, 0))} credited · reduces what's owed and the GST reported`
              : "Reduce this invoice after it's issued — a price correction, a later discount or a return"
          }
          action={
            canIssue && (
              <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Issue credit note
              </Button>
            )
          }
        />
      </CardHeader>

      {(creditNotes.length > 0 || toRefund > 0) && (
        <CardBody className="space-y-3">
          {toRefund > 0 && (
            <p className="text-sm text-red-700 dark:text-red-300">
              The customer is now owed a refund of <span className="font-semibold tabular-nums">{formatCurrency(toRefund)}</span> ·{" "}
              <a href="#payments" className="font-medium underline underline-offset-2">
                record it under Payments
              </a>
            </p>
          )}
          {creditNotes.length > 0 && (
            <ul className="divide-y divide-neutral-100 dark:divide-white/[0.06]">
              {creditNotes.map((cn) => {
                const locked = Boolean(lockedThrough && cn.noteDate <= lockedThrough);
                return (
                  <li key={cn.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {cn.number}
                        {locked && <Lock className="h-3 w-3 text-neutral-400" aria-label="Filed GST period" />}
                      </p>
                      <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
                        {formatDate(cn.noteDate)} · {cn.reason}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">−{formatCurrency(cn.grossAmount)}</p>
                      {gstRegistered && (
                        <p className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          taxable {formatCurrency(cn.taxable)} ·{" "}
                          {cn.igst ? `IGST ${formatCurrency(cn.igst)}` : `CGST ${formatCurrency(cn.cgst)} + SGST ${formatCurrency(cn.sgst)}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/invoices/${invoiceId}/credit-notes/${cn.id}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-white"
                        aria-label={`Open credit note ${cn.number}`}
                        title="Open / print"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                      {canDelete && !locked && (
                        <button
                          type="button"
                          onClick={() => remove(cn)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                          aria-label={`Delete credit note ${cn.number}`}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!saving}
        title={`Credit note against ${invoiceNumber}`}
        description={`Up to ${formatCurrency(net)} can be credited. It gets its own number and is reported in GSTR-1.`}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="credit-note-form" loading={saving} disabled={!gross || tooMuch || dateLocked}>
              Issue credit note
            </Button>
          </>
        }
      >
        <form id="credit-note-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Reason" error={errors.reason}>
            <Select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as (typeof REASONS)[number]);
                clear("reason");
              }}
            >
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label={preset === "Other" ? "Describe it" : "Details"} optional={preset !== "Other"}>
            <Input
              value={otherReason}
              onChange={(e) => {
                setOtherReason(e.target.value);
                clear("reason");
              }}
              maxLength={200}
              placeholder={preset === "Other" ? "Why the invoice is being reduced" : "e.g. agreed 5% discount on 20 Sept"}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Amount credited (incl. GST)"
              error={errors.grossAmount ?? (tooMuch ? `At most ${formatCurrency(net)}` : undefined)}
            >
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  clear("grossAmount");
                }}
                placeholder="0.00"
              />
            </Field>
            <Field
              label="Credit note date"
              error={errors.noteDate ?? (dateLocked ? `GST is filed through ${formatDate(lockedThrough!)} — pick a later date` : undefined)}
            >
              <Input
                type="date"
                value={noteDate}
                min={minDate}
                max={todayISO()}
                onChange={(e) => {
                  setNoteDate(e.target.value);
                  clear("noteDate");
                }}
              />
            </Field>
          </div>
          {gstRegistered && (
            <Field label="GST rate" hint="The rate of what's being credited; defaults to the invoice's." error={errors.gstPercent}>
              <Select value={rate} onChange={(e) => setRate(e.target.value)}>
                {[...new Set([...RATES, defaultRate])].sort((a, b) => a - b).map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <button type="button" className="text-left text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setAmount(String(net))}>
            Credit the full {formatCurrency(net)}
          </button>

          <dl className="grid grid-cols-2 gap-y-1.5 rounded-xl bg-neutral-50 p-4 text-sm dark:bg-white/[0.03]">
            {gstRegistered ? (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">Taxable value</dt>
                <dd className="text-right tabular-nums">{formatCurrency(preview.subTotal)}</dd>
                {preview.taxMode === "IGST" ? (
                  <>
                    <dt className="text-neutral-600 dark:text-neutral-400">IGST ({preview.igstPercent}%)</dt>
                    <dd className="text-right tabular-nums">{formatCurrency(preview.igstAmount)}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-neutral-600 dark:text-neutral-400">CGST ({preview.cgstPercent}%)</dt>
                    <dd className="text-right tabular-nums">{formatCurrency(preview.cgstAmount)}</dd>
                    <dt className="text-neutral-600 dark:text-neutral-400">SGST ({preview.sgstPercent}%)</dt>
                    <dd className="text-right tabular-nums">{formatCurrency(preview.sgstAmount)}</dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt className="col-span-2 text-neutral-600 dark:text-neutral-400">No GST — this business isn&apos;t GST-registered.</dt>
              </>
            )}
            <dt className="border-t border-neutral-200 pt-1.5 font-semibold text-neutral-900 dark:border-white/10 dark:text-white">Credited</dt>
            <dd className="border-t border-neutral-200 pt-1.5 text-right font-semibold tabular-nums text-red-600 dark:border-white/10 dark:text-red-400">
              −{formatCurrency(gross)}
            </dd>
          </dl>
        </form>
      </Modal>
    </Card>
  );
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
