"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

const textareaClass =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950";

export function InvoiceSettingsForm({
  defaultTerms,
  defaultNotes,
}: {
  defaultTerms: string;
  defaultNotes: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/invoice-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: String(form.get("terms") ?? ""),
          notes: String(form.get("notes") ?? ""),
        }),
      });
      if (!res.ok) {
        toast.error("Failed to save invoice settings");
        return;
      }
      toast.success("Invoice defaults saved");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Default notes
        </label>
        <input
          name="notes"
          type="text"
          defaultValue={defaultNotes}
          className={textareaClass}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Default terms & conditions
        </label>
        <textarea name="terms" rows={3} defaultValue={defaultTerms} className={textareaClass} />
      </div>
      <div>
        <Button type="submit" size="sm" loading={pending}>
          Save defaults
        </Button>
      </div>
    </form>
  );
}
