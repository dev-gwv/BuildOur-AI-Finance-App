"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function DeleteButton({
  url,
  label = "this item",
  onDeleted,
}: {
  url: string;
  label?: string;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      title={`Delete ${label}`}
      onClick={async () => {
        const ok = await confirm({
          title: `Delete ${label}?`,
          description: "This cannot be undone.",
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;

        setPending(true);
        try {
          const res = await fetch(url, { method: "DELETE" });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            toast.error(body.error ?? "Failed to delete");
            return;
          }
          toast.success("Deleted");
          onDeleted?.();
          router.refresh();
        } catch {
          toast.error("Network error — please try again");
        } finally {
          setPending(false);
        }
      }}
      className="inline-flex items-center gap-1 rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-400"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}
