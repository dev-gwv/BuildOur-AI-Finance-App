"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

export function CompanyAccessToggles({
  userId,
  companies,
  assignedCompanyIds,
}: {
  userId: string;
  companies: { id: string; name: string }[];
  assignedCompanyIds: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function toggle(companyId: string, assigned: boolean) {
    setPendingId(companyId);
    try {
      const res = assigned
        ? await fetch(`/api/users/${userId}/companies?companyId=${companyId}`, { method: "DELETE" })
        : await fetch(`/api/users/${userId}/companies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId }),
          });
      if (!res.ok) {
        toast.error("Failed to update access");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {companies.map((c) => {
        const assigned = assignedCompanyIds.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            disabled={pendingId === c.id}
            onClick={() => toggle(c.id, assigned)}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
              assigned
                ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-400"
                : "border-neutral-300 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
