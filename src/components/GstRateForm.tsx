"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

export function GstRateForm({
  companyId,
  defaultGstPercent,
}: {
  companyId: string;
  defaultGstPercent: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultGstPercent: Number(form.get("defaultGstPercent")) }),
      });
      if (!res.ok) {
        toast.error("Failed to update GST rate");
        return;
      }
      toast.success("Default GST rate updated");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 text-sm">
      <span className="text-neutral-500 dark:text-neutral-400">Default GST:</span>
      <input
        name="defaultGstPercent"
        type="number"
        step="0.01"
        min="0"
        defaultValue={defaultGstPercent}
        className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
      />
      <span className="text-neutral-500 dark:text-neutral-400">%</span>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Save
      </Button>
    </form>
  );
}
