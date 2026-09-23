"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { PenLine, Trash2, UploadCloud } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

const fieldClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export function InvoiceSettingsForm({
  defaultTerms,
  defaultNotes,
  signatureDataUri,
  razorpayFeePercent,
  razorpayFeeGstPercent,
}: {
  defaultTerms: string;
  defaultNotes: string;
  signatureDataUri: string | null;
  razorpayFeePercent: number;
  razorpayFeeGstPercent: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(signatureDataUri);
  const [removeSignature, setRemoveSignature] = useState(false);

  function onSignatureChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSignatureFile(file);
    setRemoveSignature(false);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    const body = new FormData();
    body.append("terms", String(form.get("terms") ?? ""));
    body.append("notes", String(form.get("notes") ?? ""));
    body.append("razorpayFeePercent", String(form.get("razorpayFeePercent") ?? ""));
    body.append("razorpayFeeGstPercent", String(form.get("razorpayFeeGstPercent") ?? ""));
    if (signatureFile) body.append("signature", signatureFile);
    if (removeSignature) body.append("removeSignature", "true");

    try {
      const res = await fetch("/api/invoice-settings", { method: "PATCH", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to save invoice settings");
        return;
      }
      toast.success("Invoice defaults saved");
      setSignatureFile(null);
      setRemoveSignature(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div>
        <label className={labelClass}>Default notes</label>
        <input name="notes" type="text" defaultValue={defaultNotes} className={fieldClass} />
      </div>

      <div>
        <label className={labelClass}>Default terms &amp; conditions</label>
        <textarea name="terms" rows={3} defaultValue={defaultTerms} className={fieldClass} />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Printed on every invoice. Set it once here — no need to retype it per invoice.
        </p>
      </div>

      <div>
        <label className={labelClass}>Authorised signature</label>
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-white dark:border-white/10">
            {preview && !removeSignature ? (
              // eslint-disable-next-line @next/next/no-img-element -- data/blob URI preview
              <img src={preview} alt="Signature preview" className="max-h-16 w-auto object-contain" />
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <PenLine className="h-3.5 w-3.5" />
                No signature set
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-neutral-800">
              <UploadCloud className="h-4 w-4" />
              {preview && !removeSignature ? "Replace signature" : "Upload signature"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onSignatureChange} />
            </label>
            {preview && !removeSignature && (
              <button
                type="button"
                onClick={() => {
                  setRemoveSignature(true);
                  setSignatureFile(null);
                  setPreview(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:underline dark:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove signature
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          A PNG with a transparent background looks best. Max 500 KB. This signature is printed on
          every invoice automatically.
        </p>
      </div>

      <div>
        <label className={labelClass}>Razorpay charges</label>
        <div className="mt-1 grid max-w-md grid-cols-2 gap-3">
          <label className="text-xs text-neutral-500 dark:text-neutral-400">
            Commission %
            <input
              name="razorpayFeePercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              defaultValue={razorpayFeePercent}
              className={fieldClass}
            />
          </label>
          <label className="text-xs text-neutral-500 dark:text-neutral-400">
            GST on commission %
            <input
              name="razorpayFeeGstPercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              defaultValue={razorpayFeeGstPercent}
              className={fieldClass}
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Used to estimate what Razorpay keeps from a payment marked &ldquo;Paid through Razorpay&rdquo; — the fee
          stays editable on each payment.
        </p>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          Connected to Razorpay? Exact fees come from the API instead — Settings → Integrations.
        </p>
      </div>

      <div>
        <Button type="submit" loading={pending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
