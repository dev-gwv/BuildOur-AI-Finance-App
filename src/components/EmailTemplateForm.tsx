"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { PLACEHOLDERS } from "@/lib/emailTemplate";

const fieldClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export function EmailTemplateForm({
  brand,
  brandName,
  subject,
  body,
  isDefault,
}: {
  brand: string;
  brandName: string;
  subject: string;
  body: string;
  isDefault: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [subjectValue, setSubjectValue] = useState(subject);
  const [bodyValue, setBodyValue] = useState(body);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const form = new FormData();
      form.append("brand", brand);
      form.append("subject", subjectValue);
      form.append("body", bodyValue);
      const res = await fetch("/api/email-templates", { method: "PATCH", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't save the message");
        return;
      }
      toast.success(`${brandName} email message saved`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function reset() {
    setResetting(true);
    try {
      const form = new FormData();
      form.append("brand", brand);
      form.append("reset", "true");
      const res = await fetch("/api/email-templates", { method: "PATCH", body: form });
      if (!res.ok) {
        toast.error("Couldn't restore the default message");
        return;
      }
      const { template } = await res.json();
      setSubjectValue(template.subject);
      setBodyValue(template.body);
      toast.success("Default message restored");
      router.refresh();
    } finally {
      setResetting(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <div>
        <label className={labelClass}>Subject</label>
        <input value={subjectValue} onChange={(e) => setSubjectValue(e.target.value)} className={fieldClass} />
      </div>

      <div>
        <label className={labelClass}>Message</label>
        <textarea
          value={bodyValue}
          onChange={(e) => setBodyValue(e.target.value)}
          rows={12}
          className={`${fieldClass} leading-relaxed`}
        />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Sent above the invoice summary. It can still be tweaked for one particular email when
          sending.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
          Click to insert — these fill in automatically for each customer
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <button
              key={p.token}
              type="button"
              onClick={() => setBodyValue((v) => `${v}{{${p.token}}}`)}
              title={`Insert ${p.label}`}
              className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-brand-950"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Save message
        </Button>
        {!isDefault && (
          <Button type="button" size="sm" variant="secondary" loading={resetting} onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Restore default
          </Button>
        )}
      </div>
    </form>
  );
}
