"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { controlClass } from "@/components/ui/Field";
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
        <div key={field.name} className={field.type === "number" ? "w-28" : "min-w-0 flex-1 sm:w-56 sm:flex-none"}>
          <input
            name={field.name}
            type={field.type ?? "text"}
            step={field.step}
            placeholder={field.placeholder}
            defaultValue={field.defaultValue}
            required
            aria-label={field.placeholder}
            inputMode={field.type === "number" ? "decimal" : undefined}
            // The shared control look at small-button height.
            className={controlClass(false, "h-10 sm:h-8")}
          />
        </div>
      ))}
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" />
        {submitLabel}
      </Button>
    </form>
  );
}
