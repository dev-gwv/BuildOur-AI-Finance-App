"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export type InlineField = {
  name: string;
  type?: string;
  placeholder: string;
  step?: string;
  defaultValue?: string | number;
};

export function InlineCreateForm({
  url,
  fields,
  extra,
  submitLabel = "Add",
  successMessage = "Added",
}: {
  url: string;
  fields: InlineField[];
  extra?: Record<string, unknown>;
  submitLabel?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Kept before any await: React clears e.currentTarget once the handler yields.
    const formEl = e.currentTarget;
    setPending(true);

    const form = new FormData(formEl);
    const payload: Record<string, unknown> = { ...extra };
    for (const field of fields) {
      const raw = form.get(field.name);
      payload[field.name] =
        field.type === "number" ? Number(raw ?? 0) : String(raw ?? "");
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Something went wrong");
        return;
      }
      toast.success(successMessage);
      formEl.reset();
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      {fields.map((field) => (
        <input
          key={field.name}
          name={field.name}
          type={field.type ?? "text"}
          step={field.step}
          placeholder={field.placeholder}
          defaultValue={field.defaultValue}
          required
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
        />
      ))}
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" />
        {submitLabel}
      </Button>
    </form>
  );
}
