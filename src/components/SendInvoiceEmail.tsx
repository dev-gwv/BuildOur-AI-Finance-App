"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea, useFieldErrors } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

type Draft = { configured: boolean; attachment: string | null; cancelled: boolean };

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
  const [draft, setDraft] = useState<Draft>({ configured: true, attachment: null, cancelled: false });
  const [problem, setProblem] = useState<string | null>(null);
  const { errors, apply, clear } = useFieldErrors<"to" | "subject" | "body">();

  async function openComposer() {
    setOpen(true);
    setLoading(true);
    setProblem(null);
    apply(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/email`);
      if (!res.ok) {
        setProblem("Couldn't load the email draft. Close this and try again.");
        return;
      }
      const d = await res.json();
      setTo((prev) => prev || d.to);
      setSubject(d.subject);
      setBody(d.body);
      setDraft({ configured: Boolean(d.configured), attachment: d.attachment ?? null, cancelled: Boolean(d.cancelled) });
    } catch {
      setProblem("Network error while loading the draft. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!to.trim()) {
      apply({ to: "Enter the customer's email address" });
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.append("to", to.trim());
      form.append("subject", subject);
      form.append("body", body);
      const res = await fetch(`/api/invoices/${invoiceId}/email`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Shown in the dialog, not a toast: it has to stay until it's read.
        apply(data.fields);
        setProblem(data.error ?? "Couldn't send the email");
        return;
      }
      toast.success(`Invoice emailed to ${to.trim()}${data.attachment ? ` with ${data.attachment}` : ""}`);
      setOpen(false);
      router.refresh();
    } catch {
      setProblem("Network error while sending. Nothing was sent — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button type="button" variant="secondary" onClick={openComposer}>
          <Mail className="h-4 w-4" />
          {sentAt ? (
            "Send again"
          ) : (
            <>
              <span className="sm:hidden">Email</span>
              <span className="hidden sm:inline">Email invoice</span>
            </>
          )}
        </Button>
        {sentAt && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Sent {formatDate(sentAt)}
          </span>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-brand-600" />
            Send invoice by email
          </span>
        }
        description="The customer gets your message with the tax invoice attached as a PDF."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" loading={pending} disabled={loading || !draft.configured} onClick={send}>
              <Mail className="h-4 w-4" />
              Send email
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="py-10 text-center text-sm text-neutral-600 dark:text-neutral-400">Preparing the message…</p>
        ) : (
          <div className="grid gap-4">
            {!draft.configured && (
              <div role="alert" className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Email isn&apos;t set up yet, so nothing can be sent. Whoever manages the app needs to add the SMTP settings
                  (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM) in Vercel and redeploy. You can still download the PDF and send
                  it yourself.
                </p>
              </div>
            )}
            {draft.cancelled && (
              <div role="status" className="flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>This invoice is cancelled. The attached PDF is stamped CANCELLED.</p>
              </div>
            )}
            {problem && (
              <div role="alert" className="flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{problem}</p>
              </div>
            )}

            <Field label="To" error={errors.to}>
              <Input
                type="email"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  clear("to");
                }}
                placeholder="customer@example.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Subject" error={errors.subject}>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field
              label="Message"
              error={errors.body}
              hint="The invoice summary, bank details and terms follow this message. Change the default wording in Invoice defaults."
            >
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="leading-relaxed" />
            </Field>

            {draft.attachment && (
              <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-white/10">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{draft.attachment}</p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">PDF attached · generated when you send</p>
                </div>
                <a
                  href={`/api/invoices/${invoiceId}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
                >
                  Preview
                </a>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
