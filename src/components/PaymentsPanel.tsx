"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import {
  BadgeIndianRupee,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  ScanLine,
  X,
} from "lucide-react";
import { readPaymentScreenshot } from "@/lib/clientUpload";
import { PAYMENT_METHODS, parsePaymentScreenshotText } from "@/lib/parsePaymentScreenshot";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteButton } from "@/components/DeleteButton";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { totalsByPlatform } from "@/lib/invoiceCalc";

const fieldClass =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export type PaymentRow = {
  id: string;
  amount: number;
  paidOn: string | Date;
  method: string | null;
  note: string | null;
  proofPath: string | null;
};

export function PaymentsPanel({
  invoiceId,
  total,
  payments,
}: {
  invoiceId: string;
  total: number;
  payments: PaymentRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const [overpaidBy, setOverpaidBy] = useState<number | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.round((total - paid) * 100) / 100;
  const settled = outstanding <= 0;
  const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  const byPlatform = totalsByPlatform(payments);

  // Object URLs leak until revoked, and one is created per screenshot tried.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  /**
   * Reads a screenshot and fills the form. Everything stays editable — OCR is a
   * suggestion, not a source of truth.
   */
  async function acceptProof(file: File) {
    const isImage = file.type.startsWith("image/");
    if (!isImage && file.type !== "application/pdf") {
      toast.error("Please attach an image or PDF of the payment");
      return;
    }

    setProof(file);
    setPreview(isImage ? URL.createObjectURL(file) : null);
    setScanned(null);
    setOverpaidBy(null);
    if (!isImage) return;

    setScanning(true);
    try {
      const shot = await readPaymentScreenshot(file);
      const found = parsePaymentScreenshotText(shot.text, shot.amountLine);
      const form = formRef.current;
      if (!form) return;

      const setField = (name: string, value: string) => {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement) el.value = value;
      };

      const parts: string[] = [];
      if (found.amount !== null) {
        // Fill it even when it exceeds the balance — hiding the figure the
        // screenshot actually shows would leave the user guessing why nothing
        // appeared. Flagged below, and the server refuses an overpayment.
        setField("amount", String(found.amount));
        parts.push(formatCurrency(found.amount));
        setOverpaidBy(found.amount > outstanding ? found.amount - outstanding : null);
      }
      if (found.method) {
        setField("method", found.method);
        parts.push(found.method);
      }
      if (found.paidOn) setField("paidOn", found.paidOn);
      if (found.reference) setField("note", `Ref ${found.reference}`);

      if (parts.length) {
        setScanned(parts.join(" · "));
        toast.success("Read the screenshot — please check the values before saving");
      } else {
        toast.info("Couldn't read that screenshot — please enter the details yourself");
      }
    } catch {
      toast.info("Couldn't read that screenshot — please enter the details yourself");
    } finally {
      setScanning(false);
    }
  }

  function onProofChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void acceptProof(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void acceptProof(file);
  }

  // Screenshots are usually on the clipboard rather than saved to disk, so
  // Ctrl+V is the shortest path from phone screenshot to recorded payment.
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const file = e.clipboardData?.files?.[0];
      if (file) void acceptProof(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outstanding]);

  function clearProof() {
    setProof(null);
    setPreview(null);
    setScanned(null);
    setOverpaidBy(null);
  }

  function closeForm() {
    setOpen(false);
    clearProof();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const body = new FormData(e.currentTarget);
      // The file lives in state, not the input, so a dropped or pasted
      // screenshot is saved as proof just like a browsed one.
      if (proof) body.set("proof", proof);
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't record that payment");
        return;
      }
      toast.success("Payment recorded");
      closeForm();
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          <BadgeIndianRupee className="h-4 w-4 text-indigo-500" />
          Payments
        </h2>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              settled
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            }`}
          >
            {settled ? "Fully paid" : `${formatCurrency(outstanding)} outstanding`}
          </span>
          {!settled && (
            <Button size="sm" onClick={() => (open ? closeForm() : setOpen(true))}>
              <Plus className="h-3.5 w-3.5" />
              Record payment
            </Button>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        <div className="space-y-2.5">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Invoice total</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatCurrency(total)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Received</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(paid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Balance due</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatCurrency(Math.max(outstanding, 0))}
              </dd>
            </div>
          </dl>
          <div
            className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Share of the invoice received"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                settled ? "bg-emerald-500" : "bg-indigo-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {settled
              ? "Settled in full."
              : `${progress}% received across ${payments.length} payment${payments.length === 1 ? "" : "s"}.`}
          </p>
          {byPlatform.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {byPlatform.map(([name, amount]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span className="text-neutral-500 dark:text-neutral-400">{name}</span>
                  <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(amount)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {open && !settled && (
          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/40"
          >
            <div>
              {proof ? (
                <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview}
                      alt="Payment screenshot"
                      className="h-16 w-16 shrink-0 rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
                    />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-400 dark:border-neutral-700">
                      <FileText className="h-6 w-6" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {proof.name}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {scanning
                        ? "Reading the screenshot…"
                        : scanned
                          ? `Read: ${scanned}`
                          : "Kept as proof of this payment."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearProof}
                    title="Remove this screenshot"
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-6 text-center transition-colors ${
                    dragging
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                      : "border-neutral-300 hover:border-indigo-400 dark:border-neutral-700"
                  }`}
                >
                  <ScanLine
                    className={`h-5 w-5 ${dragging ? "text-indigo-500" : "text-neutral-400"}`}
                  />
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {scanning ? "Reading the screenshot…" : "Drop the payment screenshot here"}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    or click to browse, or press Ctrl+V to paste it
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={onProofChange}
                  />
                </label>
              )}
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <ImageIcon className="h-3.5 w-3.5" />
                Works with PhonePe, GPay, Paytm and bank screenshots — the amount, platform and
                date fill in below for you to check.
              </p>
              {overpaidBy !== null && (
                <p className="mt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  That screenshot is {formatCurrency(overpaidBy)} more than the balance due —
                  check it belongs to this invoice before saving.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Amount received (₹)</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={outstanding}
                  defaultValue={outstanding}
                  required
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>Received on</label>
                <input
                  name="paidOn"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                  className={fieldClass}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Platform</label>
                <input
                  name="method"
                  list="payment-methods"
                  placeholder="PhonePe, GPay, bank transfer…"
                  className={fieldClass}
                />
                <datalist id="payment-methods">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={labelClass}>Reference / note</label>
                <input name="note" placeholder="UPI reference" className={fieldClass} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" loading={pending}>
                Save payment
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {payments.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No payments recorded yet — the full amount is outstanding.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                    <BadgeIndianRupee className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                        {formatCurrency(p.amount)}
                      </span>
                      {p.method && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          {p.method}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {formatDate(p.paidOn)}
                      {p.note && ` · ${p.note}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.proofPath && (
                    <Link
                      href={`/api/uploads/${p.proofPath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View the payment screenshot"
                      className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  <DeleteButton url={`/api/payments/${p.id}`} label="this payment" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
