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
    setPending(true);

    const form = new FormData(e.currentTarget);
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
      e.currentTarget.reset();
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
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
        />
      ))}
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" />
        {submitLabel}
      </Button>
    </form>
  );
}
