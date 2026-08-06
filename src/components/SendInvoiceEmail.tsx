"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

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
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(!customerEmail);
  const [to, setTo] = useState(customerEmail ?? "");

  async function send() {
    if (!to.trim()) {
      toast.error("Enter the customer's email address");
      setEditing(true);
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.append("to", to.trim());
      const res = await fetch(`/api/invoices/${invoiceId}/email`, { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't send the email");
        return;
      }
      toast.success(`Invoice emailed to ${to.trim()}`);
      setEditing(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {editing ? (
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="customer@example.com"
          className="w-56 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
          title="Change address"
        >
          {to}
        </button>
      )}

      <Button type="button" variant="secondary" loading={pending} onClick={send}>
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
  );
}
