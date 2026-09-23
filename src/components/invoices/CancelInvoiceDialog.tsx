"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Textarea, useFieldErrors } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/**
 * "Cancel invoice" — for an invoice raised by mistake. When it can't be
 * cancelled (money received, a credit note, a filed period) the button stays
 * visible but explains why instead of failing after a click.
 */
export function CancelInvoiceDialog({
  invoiceId,
  invoiceNumber,
  blockedReason,
}: {
  invoiceId: string;
  invoiceNumber: string;
  /** Why cancelling isn't possible right now, or null when it is. */
  blockedReason: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { errors, apply, clear } = useFieldErrors<"reason">();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      apply({ reason: "Say why it's being cancelled — it's kept on the record" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        apply(data.fields);
        if (!data.fields) toast.error(data.error ?? "Couldn't cancel the invoice");
        return;
      }
      toast.success(`${invoiceNumber} cancelled — its number stays in the series`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => (blockedReason ? toast.info(blockedReason) : setOpen(true))}
        aria-disabled={Boolean(blockedReason)}
        title={blockedReason ?? "Cancel this invoice"}
        className={blockedReason ? "opacity-60" : "text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"}
      >
        <Ban className="h-4 w-4" />
        <span className="hidden sm:inline">Cancel invoice</span>
        <span className="sm:hidden">Cancel</span>
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!saving}
        size="sm"
        title={`Cancel ${invoiceNumber}?`}
        description="For an invoice raised by mistake. It keeps its number (GST numbering can't have gaps), counts for nothing, and isn't reported."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Keep it
            </Button>
            <Button type="submit" form="cancel-invoice-form" variant="danger" loading={saving}>
              Cancel invoice
            </Button>
          </>
        }
      >
        <form id="cancel-invoice-form" onSubmit={onSubmit} noValidate>
          <Field label="Reason" error={errors.reason} hint="e.g. raised twice by mistake, wrong customer">
            <Textarea
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                clear("reason");
              }}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
