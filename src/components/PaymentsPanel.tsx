"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { BadgeIndianRupee, Paperclip, Plus, ScanLine } from "lucide-react";
import { readImageTextInBrowser } from "@/lib/clientUpload";
import { parsePaymentScreenshotText } from "@/lib/parsePaymentScreenshot";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteButton } from "@/components/DeleteButton";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDate } from "@/lib/format";

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
  const formRef = useRef<HTMLFormElement>(null);

  /** Reads a UPI screenshot and fills the form; every value stays editable. */
  async function onProofChange(e: ChangeEvent<HTMLInputElement>) {
    const proof = e.target.files?.[0];
    if (!proof || !proof.type.startsWith("image/")) return;
    setScanning(true);
    setScanned(null);
    try {
      const found = parsePaymentScreenshotText(await readImageTextInBrowser(proof));
      const form = formRef.current;
      if (!form) return;

      const setField = (name: string, value: string) => {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement) el.value = value;
      };

      const parts: string[] = [];
      if (found.amount !== null && found.amount <= outstanding) {
        setField("amount", String(found.amount));
        parts.push(formatCurrency(found.amount));
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

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.round((total - paid) * 100) / 100;
  const settled = outstanding <= 0;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't record that payment");
        return;
      }
      toast.success("Payment recorded");
      setOpen(false);
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
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              <Plus className="h-3.5 w-3.5" />
              Record payment
            </Button>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Invoice total</dt>
            <dd className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {formatCurrency(total)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Received</dt>
            <dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(paid)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Balance due</dt>
            <dd className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {formatCurrency(Math.max(outstanding, 0))}
            </dd>
          </div>
        </dl>

        {open && !settled && (
          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="grid gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
          >
            <div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-400">
                <ScanLine className="h-4 w-4" />
                {scanning ? "Reading the screenshot…" : "Upload the payment screenshot to fill this in"}
                <input
                  name="proof"
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={onProofChange}
                />
              </label>
              {scanned && (
                <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  Read from screenshot: {scanned} — check it below before saving.
                </p>
              )}
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Works with PhonePe, GPay, Paytm and bank screenshots. The image is kept as proof.
              </p>
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
                <label className={labelClass}>Method</label>
                <input name="method" placeholder="PhonePe, GPay, bank transfer…" className={fieldClass} />
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
              <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
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
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(p.amount)}
                  </span>
                  <span className="ml-2 text-neutral-500 dark:text-neutral-400">{formatDate(p.paidOn)}</span>
                  {p.method && <span className="ml-2 text-neutral-500 dark:text-neutral-400">· {p.method}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.proofPath && (
                    <Link
                      href={`/api/uploads/${p.proofPath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View proof"
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
