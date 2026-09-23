"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

/** Retries one failed sheet write, or all of them when no id is given. */
export function SyncRetryButton({ failureId, label }: { failureId?: string; label?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function retry() {
    setPending(true);
    try {
      const url = failureId ? `/api/sheet-sync/${failureId}/retry` : "/api/sheet-sync/retry-all";
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Retry failed");
      } else if (failureId) {
        toast.success("Written to the sheet");
      } else if (body.fixed === body.attempted) {
        toast.success(`All ${body.attempted} written to the sheets`);
      } else {
        toast.error(`${body.fixed} of ${body.attempted} went through — the rest still fail`);
      }
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant={failureId ? "secondary" : "primary"} loading={pending} onClick={retry}>
      {!pending && <RefreshCw className="h-3.5 w-3.5" />}
      {label ?? "Retry"}
    </Button>
  );
}
