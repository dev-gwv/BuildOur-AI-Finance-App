"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

const fieldClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400";

export function SendInvoiceEmail({
  invoiceId,
  customerEmail,
  sentAt,
}: {
  invoiceId: string;
  customerEmail: string | null;
  sentAt: Date | string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [to, setTo] = useState(customerEmail ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  async function openComposer() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/email`);
      if (!res.ok) {
        toast.error("Couldn't load the email draft");
        return;
      }
      const draft = await res.json();
      setTo((prev) => prev || draft.to);
      setSubject(draft.subject);
      setBody(draft.body);
      if (!draft.configured) {
        toast.info("Email isn't set up yet — add the SMTP settings before sending");
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!to.trim()) {
      toast.error("Enter the customer's email address");
      return;
    }
    setPending(true);
    try {
      const form = new FormData();
      form.append("to", to.trim());
      form.append("subject", subject);
      form.append("body", body);
      const res = await fetch(`/api/invoices/${invoiceId}/email`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't send the email");
        return;
      }
      toast.success(`Invoice emailed to ${to.trim()}`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button type="button" variant="secondary" onClick={openComposer}>
          <Mail className="h-4 w-4" />
          {sentAt ? "Send again" : "Email invoice"}
        </Button>
        {sentAt && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Sent {formatDate(sentAt)}
          </span>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10 print:hidden">
          <div className="w-full max-w-2xl rounded-xl border border-neutral-200 bg-white shadow-pop dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4 dark:border-white/[0.06]">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                <Mail className="h-4 w-4 text-brand-500" />
                Send invoice by email
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 px-5 py-4">
              {loading ? (
                <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  Preparing the message…
                </p>
              ) : (
                <>
                  <div>
                    <label className={labelClass}>To</label>
                    <input
                      type="email"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="customer@example.com"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Subject</label>
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Message</label>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={11}
                      className={`${fieldClass} leading-relaxed`}
                    />
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      The invoice summary, bank details and terms are added below this message
                      automatically. Edit the wording for everyone in Invoice Settings.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-5 py-4 dark:border-white/[0.06]">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" loading={pending} disabled={loading} onClick={send}>
                <Mail className="h-4 w-4" />
                Send email
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
