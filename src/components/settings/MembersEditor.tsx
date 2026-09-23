"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { initials } from "@/lib/format";
import { request } from "./request";

/** Which team members can see and work in this business. Admins always can. */
export function MembersEditor({
  businessId,
  users,
  memberIds,
}: {
  businessId: string;
  users: { id: string; name: string; email: string; active: boolean }[];
  memberIds: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState(() => new Set(memberIds));
  const [pending, setPending] = useState(false);
  const dirty = selected.size !== memberIds.length || memberIds.some((id) => !selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setPending(true);
    const result = await request(`/api/businesses/${businessId}/members`, "PUT", { userIds: [...selected] });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Access updated");
    router.refresh();
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        There are no team members yet — only admins, who can see every business. Add people in Team.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {users.map((u) => {
          const on = selected.has(u.id);
          return (
            <li key={u.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  on
                    ? "border-brand-300 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10"
                    : "border-neutral-200 hover:border-neutral-300 dark:border-white/10"
                }`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(u.id)} className="h-4 w-4 accent-brand-600" />
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                  {initials(u.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {u.name}
                    {!u.active && <span className="ml-1.5 text-xs font-normal text-neutral-400">(deactivated)</span>}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">{u.email}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} loading={pending} disabled={!dirty}>
          Save access
        </Button>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Members see and work on this business&apos;s invoices, payments, entries and reports. Admins always see every business.
        </p>
      </div>
    </div>
  );
}
