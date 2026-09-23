"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { request } from "./request";

/** Confirms an automatically set-up business's settings, clearing its review flag. */
export function MarkReviewedButton({ businessId }: { businessId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function markReviewed() {
    setPending(true);
    const result = await request(`/api/businesses/${businessId}`, "PATCH", { reviewed: true });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Marked as reviewed");
    router.refresh();
  }

  return (
    <Button variant="brand" onClick={markReviewed} loading={pending}>
      {!pending && <CheckCircle2 className="h-4 w-4" />}
      Mark as reviewed
    </Button>
  );
}

/**
 * Archiving hides a business from the switcher and new-invoice pickers; its
 * invoices, payments and history stay. Nothing is deleted.
 */
export function ArchiveButton({ businessId, archived, name }: { businessId: string; archived: boolean; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (!archived) {
      const ok = await confirm({
        title: `Archive ${name}?`,
        description:
          "It disappears from the business switcher and can't take new invoices or entries. Everything already recorded stays, and it can be restored any time.",
        confirmLabel: "Archive",
        danger: true,
      });
      if (!ok) return;
    }
    setPending(true);
    const result = await request(`/api/businesses/${businessId}`, "PATCH", { archived: !archived });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(archived ? "Restored" : "Archived");
    router.refresh();
  }

  return (
    <Button variant={archived ? "secondary" : "ghost"} onClick={toggle} loading={pending}>
      {!pending && (archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />)}
      {archived ? "Restore business" : "Archive business"}
    </Button>
  );
}
