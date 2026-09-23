"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import {
  BadgeIndianRupee,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  ScanLine,
  ShieldCheck,
  X,
} from "lucide-react";
import { readPaymentScreenshot } from "@/lib/clientUpload";
import { PAYMENT_METHODS, parsePaymentScreenshotText } from "@/lib/parsePaymentScreenshot";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DeleteButton } from "@/components/DeleteButton";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { totalsByPlatform } from "@/lib/invoiceCalc";
import { calculateGatewayFee } from "@/lib/calc";

const fieldClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export type PaymentRow = {
  id: string;
  amount: number;
  paidOn: string | Date;
  method: string | null;
  note: string | null;
  proofPath: string | null;
  /** Gateway that kept a commission (e.g. "Razorpay"); fees come out of what lands in the bank. */
  gateway?: string | null;
  gatewayRef?: string | null;
  feeAmount?: number;
  feeGstAmount?: number;
};

/** A payment as the Razorpay integration returns it (rupees). */
type RazorpayPick = {
  id: string;
  status: string;
  amount: number;
  feeAmount: number;
  feeGstAmount: number;
  method: string | null;
  paidOn: string;
  email: string | null;
  contact: string | null;
  vpa: string | null;
  recordedOn: { id: string; invoiceNumber: string } | null;
};

type VerifyState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; message: string }
  /** `blocking` errors stop the save (duplicate, not captured); others fall back to the estimate. */
  | { state: "error"; message: string; blocking?: boolean };

const RAZORPAY_ID = /^pay_[A-Za-z0-9]{14}$/;

const round2 = (n: number) => Math.round(n * 100) / 100;
const feesOf = (p: PaymentRow) => round2((p.feeAmount ?? 0) + (p.feeGstAmount ?? 0));

export function PaymentsPanel({
  invoiceId,
  total,
  payments,
  razorpayRates = { feePercent: 2, feeGstPercent: 18 },
}: {
  invoiceId: string;
  total: number;
  payments: PaymentRow[];
  /** Razorpay's commission and the GST on it, from Invoice Settings. */
  razorpayRates?: { feePercent: number; feeGstPercent: number };
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

  /** The payment being edited, or null when recording a new one. */
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState("");
  const [viaRazorpay, setViaRazorpay] = useState(false);
  const [gatewayRef, setGatewayRef] = useState("");
  const [detected, setDetected] = useState<string | null>(null);
  /** null = follow the configured rate; a string = typed over by the user. */
  const [feeInput, setFeeInput] = useState<string | null>(null);
  const [feeGstInput, setFeeGstInput] = useState<string | null>(null);

  // Razorpay API (opt-in under Settings → Integrations). When connected, a
  // pay_ id is checked against Razorpay and its exact fee replaces the estimate.
  const [rzpConnected, setRzpConnected] = useState(false);
  const rzpChecked = useRef(false);
  const verifiedRef = useRef<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ state: "idle" });
  const [overrideFees, setOverrideFees] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recent, setRecent] = useState<RazorpayPick[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const feesExact = verify.state === "ok" && !overrideFees;

  const paid =payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.round((total - paid) * 100) / 100;
  const settled = outstanding <= 0;
  const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  // Editing a payment frees up its own amount again.
  const limit = round2(outstanding + (editing?.amount ?? 0));

  // A payment with no platform typed but a gateway set came through that gateway.
  const byPlatform = totalsByPlatform(payments.map((p) => ({ amount: p.amount, method: p.method || p.gateway || null })));
  const totalFees = round2(payments.reduce((sum, p) => sum + feesOf(p), 0));

  // Live Razorpay breakdown. The fee follows the configured rate until typed
  // over (UPI through Razorpay is often 0%); its GST follows the fee until
  // that's typed over too.
  const amountValue = Number(amount) || 0;
  const autoFee = calculateGatewayFee(amountValue, razorpayRates.feePercent, razorpayRates.feeGstPercent);
  const feeValue = feeInput === null ? autoFee.feeAmount : Math.max(0, Number(feeInput) || 0);
  const feeGstValue =
    feeGstInput !== null
      ? Math.max(0, Number(feeGstInput) || 0)
      : feeInput === null
        ? autoFee.feeGstAmount
        : round2(feeValue * (razorpayRates.feeGstPercent / 100));
  const landsInBank = round2(amountValue - feeValue - feeGstValue);
  const effectiveFeePercent = amountValue > 0 ? round2((feeValue / amountValue) * 100) : razorpayRates.feePercent;

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
        setAmount(String(found.amount));
        parts.push(formatCurrency(found.amount));
        setOverpaidBy(found.amount > limit ? found.amount - limit : null);
      }
      if (found.method) {
        setField("method", found.method);
        parts.push(found.method);
      }
      if (found.gateway === "Razorpay") {
        // Razorpay keeps a cut, so its fee switch goes on by itself.
        setViaRazorpay(true);
        setFeeInput(null);
        setFeeGstInput(null);
        if (found.gatewayRef) setGatewayRef(found.gatewayRef);
        setDetected(`Razorpay detected${found.gatewayRef ? ` · ${found.gatewayRef}` : ""}`);
        if (found.method !== "Razorpay") parts.push("via Razorpay");
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
  }, [open, limit]);

  function clearProof() {
    setProof(null);
    setPreview(null);
    setScanned(null);
    setOverpaidBy(null);
  }

  function resetGateway() {
    setViaRazorpay(false);
    setGatewayRef("");
    setDetected(null);
    setFeeInput(null);
    setFeeGstInput(null);
    setVerify({ state: "idle" });
    setOverrideFees(false);
    setPickerOpen(false);
    verifiedRef.current = null;
  }

  /** Fills the form from Razorpay's own record of a payment: exact amount, date and fee. */
  function applyRazorpay(p: RazorpayPick) {
    verifiedRef.current = p.id;
    setViaRazorpay(true);
    setGatewayRef(p.id);
    setPickerOpen(false);
    // The payment being edited is allowed to carry its own id.
    if (p.recordedOn && editing?.gatewayRef !== p.id) {
      setVerify({ state: "error", message: `Already recorded on ${p.recordedOn.invoiceNumber}`, blocking: true });
      return;
    }
    if (p.status !== "captured") {
      setVerify({ state: "error", message: `Razorpay says this payment is "${p.status}", not captured`, blocking: true });
      return;
    }
    setAmount(String(p.amount));
    setOverpaidBy(p.amount > limit ? p.amount - limit : null);
    const form = formRef.current;
    const paidOnField = form?.elements.namedItem("paidOn");
    if (paidOnField instanceof HTMLInputElement) paidOnField.value = p.paidOn;
    const methodField = form?.elements.namedItem("method");
    if (methodField instanceof HTMLInputElement && !methodField.value) methodField.value = "Razorpay";
    setFeeInput(String(p.feeAmount));
    setFeeGstInput(String(p.feeGstAmount));
    setOverrideFees(false);
    setVerify({
      state: "ok",
      message: `Verified with Razorpay · fee ${formatCurrency(p.feeAmount)} + GST ${formatCurrency(p.feeGstAmount)}`,
    });
  }

  async function openPicker() {
    setPickerOpen((v) => !v);
    if (recent) return;
    setRecentError(null);
    try {
      const res = await fetch("/api/integrations/razorpay/payments?recent=1");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRecentError(data.error ?? "Couldn't load payments from Razorpay");
        return;
      }
      setRecent(data.payments ?? []);
    } catch {
      setRecentError("Couldn't reach Razorpay — check your connection");
    }
  }

  // Whether Razorpay's API is connected, asked once when the form first opens.
  useEffect(() => {
    if (!open || rzpChecked.current) return;
    rzpChecked.current = true;
    fetch("/api/integrations/razorpay")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRzpConnected(Boolean(data?.connected)))
      .catch(() => {});
  }, [open]);

  // A pay_ id (read by OCR or typed) is checked against Razorpay once it looks complete.
  useEffect(() => {
    if (!rzpConnected || !viaRazorpay) return;
    const id = gatewayRef.trim();
    if (!RAZORPAY_ID.test(id) || verifiedRef.current === id) return;
    const timer = setTimeout(async () => {
      setVerify({ state: "loading" });
      try {
        const res = await fetch(`/api/integrations/razorpay/payments?id=${encodeURIComponent(id)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          verifiedRef.current = id;
          setVerify({
            state: "error",
            message: `${data.error ?? "Razorpay couldn't find that payment"} — using the % estimate`,
          });
          return;
        }
        applyRazorpay(data.payment);
      } catch {
        verifiedRef.current = id;
        setVerify({ state: "error", message: "Couldn't reach Razorpay — using the % estimate" });
      }
    }, 500);
    return () => clearTimeout(timer);
    // applyRazorpay reads the latest editing/limit on each run; the trigger is the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rzpConnected, viaRazorpay, gatewayRef]);

  function closeForm() {
    setOpen(false);
    setEditing(null);
    clearProof();
    resetGateway();
  }

  function openNew() {
    clearProof();
    resetGateway();
    setEditing(null);
    setAmount(String(Math.max(outstanding, 0)));
    setOpen(true);
  }

  function openEdit(p: PaymentRow) {
    clearProof();
    resetGateway();
    setEditing(p);
    setAmount(String(p.amount));
    if (p.gateway) {
      setViaRazorpay(true);
      setGatewayRef(p.gatewayRef ?? "");
      // Already checked when it was saved; re-fetching would overwrite a
      // deliberately partial amount with Razorpay's full one.
      verifiedRef.current = p.gatewayRef ?? null;
      // Fees that match the configured rate keep following it as the amount
      // changes; ones typed over by hand stay exactly as they were.
      const fee = p.feeAmount ?? 0;
      const feeGst = p.feeGstAmount ?? 0;
      const auto = calculateGatewayFee(p.amount, razorpayRates.feePercent, razorpayRates.feeGstPercent);
      setFeeInput(Math.abs(fee - auto.feeAmount) < 0.01 ? null : String(fee));
      setFeeGstInput(
        Math.abs(feeGst - round2(fee * (razorpayRates.feeGstPercent / 100))) < 0.01 ? null : String(feeGst)
      );
    }
    setOpen(true);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const body = new FormData(e.currentTarget);
      // The file lives in state, not the input, so a dropped or pasted
      // screenshot is saved as proof just like a browsed one.
      if (proof) body.set("proof", proof);
      body.set("amount", amount);
      // Always sent, so switching Razorpay off on an edit clears its fees.
      body.set("gateway", viaRazorpay ? "Razorpay" : "");
      body.set("gatewayRef", viaRazorpay ? gatewayRef.trim() : "");
      body.set("feeAmount", viaRazorpay ? String(feeValue) : "0");
      body.set("feeGstAmount", viaRazorpay ? String(feeGstValue) : "0");
      const res = editing
        ? await fetch(`/api/payments/${editing.id}`, { method: "PATCH", body })
        : await fetch(`/api/invoices/${invoiceId}/payments`, { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? (editing ? "Couldn't update that payment" : "Couldn't record that payment"));
        return;
      }
      const { warning } = await res.json().catch(() => ({}));
      toast.success(editing ? "Payment updated" : "Payment recorded");
      if (warning) toast.info(warning);
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
          <BadgeIndianRupee className="h-4 w-4 text-brand-500" />
          Payments
        </h2>
        <div className="flex items-center gap-3">
          <Badge tone={settled ? "success" : "warning"} dot>
            {settled ? "Fully paid" : `${formatCurrency(outstanding)} outstanding`}
          </Badge>
          {!settled && (
            <Button size="sm" onClick={() => (open && !editing ? closeForm() : openNew())}>
              <Plus className="h-3.5 w-3.5" />
              Record payment
            </Button>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        <div className="space-y-2.5">
          {/* Phones: one row per figure, label left, amount right. */}
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 sm:gap-3">
            <div className="flex items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Invoice total</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatCurrency(total)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Received</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(paid)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 sm:block">
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
                settled ? "bg-emerald-500" : "bg-brand-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* With nothing received yet, the empty list below already says so. */}
          {payments.length > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {settled
                ? "Settled in full."
                : `${progress}% received across ${payments.length} payment${payments.length === 1 ? "" : "s"}.`}
            </p>
          )}
          {byPlatform.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {byPlatform.map(([name, amt]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs dark:border-white/[0.06] dark:bg-neutral-900"
                >
                  <span className="text-neutral-500 dark:text-neutral-400">{name}</span>
                  <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(amt)}
                  </span>
                </span>
              ))}
            </div>
          )}
          {totalFees > 0 && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <span>Gateway fees (commission + GST)</span>
              <span className="font-semibold tabular-nums">
                −{formatCurrency(totalFees)} · {formatCurrency(round2(paid - totalFees))} landed in the bank
              </span>
            </p>
          )}
        </div>

        {open && (editing || !settled) && (
          <form
            key={editing?.id ?? "new"}
            ref={formRef}
            onSubmit={onSubmit}
            className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-white/[0.06] dark:bg-neutral-950/40"
          >
            {editing && (
              <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                Editing the {formatCurrency(editing.amount)} payment of {formatDate(editing.paidOn)}
                {editing.proofPath && " — attach a new screenshot only to replace its proof"}
              </p>
            )}
            <div>
              {proof ? (
                <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-white/[0.06] dark:bg-neutral-900">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview}
                      alt="Payment screenshot"
                      className="h-16 w-16 shrink-0 rounded-md border border-neutral-200 object-cover dark:border-white/10"
                    />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-400 dark:border-white/10">
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
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40"
                      : "border-neutral-200 hover:border-brand-400 dark:border-white/10"
                  }`}
                >
                  <ScanLine className={`h-5 w-5 ${dragging ? "text-brand-500" : "text-neutral-400"}`} />
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {scanning
                      ? "Reading the screenshot…"
                      : editing
                        ? "Drop a new screenshot to replace the proof (optional)"
                        : "Drop the payment screenshot here"}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    or click to browse, or press Ctrl+V to paste it
                  </span>
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={onProofChange} />
                </label>
              )}
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <ImageIcon className="h-3.5 w-3.5" />
                Works with PhonePe, GPay, Paytm, Razorpay and bank screenshots — the amount, platform and
                date fill in below for you to check.
              </p>
              {rzpConnected && (
                <div className="relative mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => void openPicker()}>
                    <ListChecks className="h-3.5 w-3.5" />
                    Pick from Razorpay
                  </Button>
                  {pickerOpen && (
                    <div className="absolute left-0 top-full z-20 mt-2 max-h-80 w-full max-w-md overflow-y-auto rounded-xl border border-neutral-200/80 bg-white p-1 shadow-pop dark:border-white/10 dark:bg-neutral-900">
                      {recentError ? (
                        <p className="px-3 py-3 text-xs text-red-600 dark:text-red-400">{recentError}</p>
                      ) : recent === null ? (
                        <p className="flex items-center gap-2 px-3 py-3 text-xs text-neutral-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading the last 14 days from Razorpay…
                        </p>
                      ) : recent.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-neutral-500">No captured payments in the last 14 days.</p>
                      ) : (
                        recent.map((p) => {
                          const taken = Boolean(p.recordedOn) && editing?.gatewayRef !== p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              disabled={taken}
                              onClick={() => applyRazorpay(p)}
                              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-white/[0.06]"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                  {p.vpa || p.contact || p.email || p.id}
                                </span>
                                <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                                  {formatDate(p.paidOn)}
                                  {p.method && ` · ${p.method.toUpperCase()}`}
                                  {taken ? ` · on ${p.recordedOn!.invoiceNumber}` : ` · ${p.id}`}
                                </span>
                              </span>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                                {formatCurrency(p.amount)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
              {overpaidBy !== null && (
                <p className="mt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  That&apos;s {formatCurrency(overpaidBy)} more than the balance due — check it belongs to
                  this invoice before saving.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Amount the customer paid (₹)</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={limit}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    const n = Number(e.target.value);
                    setOverpaidBy(n > limit ? n - limit : null);
                  }}
                  required
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>Received on</label>
                <input
                  name="paidOn"
                  type="date"
                  defaultValue={(editing ? new Date(editing.paidOn) : new Date()).toISOString().slice(0, 10)}
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
                  defaultValue={editing?.method ?? ""}
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
                <input
                  name="note"
                  defaultValue={editing?.note ?? ""}
                  placeholder="UPI reference"
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-white/[0.06] dark:bg-neutral-900">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Paid through Razorpay</p>
                  <p
                    className={`text-xs ${
                      detected ? "font-medium text-brand-600 dark:text-brand-400" : "text-neutral-500 dark:text-neutral-400"
                    }`}
                  >
                    {detected ?? "Razorpay keeps a commission, plus GST on it, before paying out."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={viaRazorpay}
                  aria-label="Paid through Razorpay"
                  onClick={() => {
                    setViaRazorpay((v) => !v);
                    setFeeInput(null);
                    setFeeGstInput(null);
                    setVerify({ state: "idle" });
                    setOverrideFees(false);
                    verifiedRef.current = null;
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    viaRazorpay ? "bg-brand-600" : "bg-neutral-300 dark:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      viaRazorpay ? "translate-x-[18px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {viaRazorpay && (
                <div className="mt-3 grid gap-3 border-t border-neutral-100 pt-3 dark:border-white/[0.06]">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className={labelClass}>Razorpay payment ID</label>
                      <input
                        value={gatewayRef}
                        onChange={(e) => {
                          setGatewayRef(e.target.value);
                          // A different id invalidates what the old one verified.
                          if (verify.state !== "idle") {
                            setVerify({ state: "idle" });
                            if (feesExact) {
                              setFeeInput(null);
                              setFeeGstInput(null);
                            }
                          }
                        }}
                        placeholder="pay_…"
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Razorpay fee (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        readOnly={feesExact}
                        value={feeInput ?? String(feeValue)}
                        onChange={(e) => setFeeInput(e.target.value)}
                        className={`${fieldClass} ${feesExact ? "bg-neutral-50 text-neutral-500 dark:bg-white/[0.03]" : ""}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>GST on fee (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        readOnly={feesExact}
                        value={feeGstInput ?? String(feeGstValue)}
                        onChange={(e) => setFeeGstInput(e.target.value)}
                        className={`${fieldClass} ${feesExact ? "bg-neutral-50 text-neutral-500 dark:bg-white/[0.03]" : ""}`}
                      />
                    </div>
                  </div>
                  {verify.state !== "idle" && (
                    <p
                      className={`flex flex-wrap items-center gap-1.5 text-xs font-medium ${
                        verify.state === "ok"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : verify.state === "loading"
                            ? "text-neutral-500"
                            : verify.blocking
                              ? "text-red-600 dark:text-red-400"
                              : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {verify.state === "loading" ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Checking with Razorpay…
                        </>
                      ) : verify.state === "ok" ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {verify.message}
                          {!overrideFees && (
                            <button
                              type="button"
                              onClick={() => setOverrideFees(true)}
                              className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                            >
                              · override
                            </button>
                          )}
                        </>
                      ) : (
                        verify.message
                      )}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-neutral-500 dark:text-neutral-400">Customer paid</dt>
                      <dd className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                        {formatCurrency(amountValue)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500 dark:text-neutral-400">Razorpay fee ({effectiveFeePercent}%)</dt>
                      <dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        −{formatCurrency(feeValue)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500 dark:text-neutral-400">GST on fee</dt>
                      <dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        −{formatCurrency(feeGstValue)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500 dark:text-neutral-400">Lands in bank</dt>
                      <dd
                        className={`font-semibold tabular-nums ${
                          landsInBank > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {formatCurrency(landsInBank)}
                      </dd>
                    </div>
                  </dl>
                  {!feesExact && (feeInput !== null || feeGstInput !== null) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFeeInput(null);
                        setFeeGstInput(null);
                        setVerify({ state: "idle" });
                        setOverrideFees(false);
                      }}
                      className="justify-self-start text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Use the standard {razorpayRates.feePercent}% + {razorpayRates.feeGstPercent}% GST rate
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                loading={pending}
                disabled={
                  viaRazorpay &&
                  (landsInBank <= 0 || verify.state === "loading" || (verify.state === "error" && verify.blocking === true))
                }
              >
                {editing ? "Save changes" : "Save payment"}
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
          <ul className="divide-y divide-neutral-100 text-sm dark:divide-white/[0.05]">
            {payments.map((p) => {
              const fee = feesOf(p);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                      <BadgeIndianRupee className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                          {formatCurrency(p.amount)}
                        </span>
                        {p.method && <Badge tone="brand">{p.method}</Badge>}
                        {p.gateway && p.gateway !== p.method && <Badge>via {p.gateway}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {formatDate(p.paidOn)}
                        {p.note && ` · ${p.note}`}
                        {p.gatewayRef && ` · ${p.gatewayRef}`}
                      </p>
                      {fee > 0 && (
                        <p className="mt-0.5 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          <span className="text-amber-700 dark:text-amber-400">
                            −{formatCurrency(fee)} {p.gateway ?? "gateway"}
                          </span>
                          {" · "}
                          {formatCurrency(round2(p.amount - fee))} received
                        </p>
                      )}
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
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      title="Edit this payment"
                      className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <DeleteButton url={`/api/payments/${p.id}`} label="this payment" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
