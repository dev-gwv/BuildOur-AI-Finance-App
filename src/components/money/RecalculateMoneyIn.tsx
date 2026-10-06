"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatCurrency } from "@/lib/format";

/**
 * Shown to admins while money-in entries saved under the old GST rule remain.
 * One click brings them all onto GST-inside-the-gross and rewrites their
 * sheet rows; it disappears once there's nothing left to correct.
 */
export function RecalculateMoneyIn({ count }: { count: number }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);

  async function run() {
    const ok = await confirm({
      title: `Recalculate ${count} money-in entr${count === 1 ? "y" : "ies"}?`,
      description:
        "GST is taken from inside each gross amount and the gateway charge from the whole amount, the way new entries work. The gross amounts don't change; the GST and net do, and their Google Sheet rows are rewritten. Every change is in the audit log.",
      confirmLabel: "Recalculate",
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch("/api/entries/recalculate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error ?? "Couldn't recalculate the entries");
      toast.success(
        `Recalculated ${data.updated} entr${data.updated === 1 ? "y" : "ies"} · net ${formatCurrency(data.netBefore)} → ${formatCurrency(data.netAfter)}`
      );
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
      <p>
        <span className="font-semibold">
          {count} money-in entr{count === 1 ? "y was" : "ies were"} saved with the old GST calculation
        </span>{" "}
        (GST added on top of what was left after the gateway). Recalculate to take GST from inside the gross, like new entries.
      </p>
      <Button size="sm" variant="secondary" onClick={run} loading={pending} className="shrink-0">
        <RefreshCw className="h-3.5 w-3.5" />
        Recalculate
      </Button>
    </div>
  );
}
