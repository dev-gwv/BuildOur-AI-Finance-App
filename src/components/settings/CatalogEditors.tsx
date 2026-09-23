"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlClass } from "@/components/ui/Field";
import { DeleteButton } from "@/components/DeleteButton";
import { useToast } from "@/components/ui/Toast";
import { request } from "./request";

// Compact inline editors: the shared control look at the height of a small
// button (44px on phones, 32px from sm). The shared class is full-width, so
// each control sits in a sized wrapper.
const smallInput = controlClass(false, "h-10 px-2.5 sm:h-8");

/** A business's categories for money in/out entries. */
export function CategoriesEditor({
  businessId,
  categories,
}: {
  businessId: string;
  categories: { id: string; name: string; entries: number }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await request(`/api/businesses/${businessId}/categories`, "POST", { name: name.trim() });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    setName("");
    toast.success("Category added");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {categories.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <Tag className="h-4 w-4" />
          No categories yet — add ones like Sales, Rent, Salaries or Marketing.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white py-0.5 pl-2.5 pr-0.5 text-sm dark:border-white/10 dark:bg-white/[0.03]"
            >
              <span className="text-neutral-800 dark:text-neutral-200">{c.name}</span>
              {c.entries > 0 ? (
                <span className="px-1.5 text-[11px] text-neutral-400" title="Entries use it, so it can't be removed">
                  {c.entries}
                </span>
              ) : (
                <DeleteButton url={`/api/businesses/${businessId}/categories/${c.id}`} label={c.name} />
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-56">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category"
            aria-label="New category name"
            required
            maxLength={60}
            className={smallInput}
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </form>
    </div>
  );
}

/** A business's payment gateways and the % each keeps. */
export function GatewaysEditor({
  businessId,
  gateways,
}: {
  businessId: string;
  gateways: { id: string; name: string; chargePercent: number }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("");
  const [pending, setPending] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await request(`/api/businesses/${businessId}/gateways`, "POST", {
      name: name.trim(),
      chargePercent: Number(percent),
    });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    setName("");
    setPercent("");
    toast.success("Gateway added");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {gateways.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <CreditCard className="h-4 w-4" />
          No gateways yet — add Razorpay, PayU, TagMango or any processor with the % it keeps.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200/80 dark:divide-white/[0.05] dark:border-white/[0.07]">
          {gateways.map((g) => (
            <GatewayRow key={g.id} businessId={businessId} gateway={g} />
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gateway (e.g. Razorpay)"
            aria-label="Gateway name"
            required
            maxLength={60}
            className={smallInput}
          />
        </div>
        <div className="w-20">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="%"
            aria-label="Charge %"
            required
            className={`${smallInput} tabular-nums`}
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </form>
    </div>
  );
}

function GatewayRow({
  businessId,
  gateway,
}: {
  businessId: string;
  gateway: { id: string; name: string; chargePercent: number };
}) {
  const router = useRouter();
  const toast = useToast();
  const [percent, setPercent] = useState(String(gateway.chargePercent));
  const [pending, setPending] = useState(false);
  const dirty = Number(percent) !== gateway.chargePercent;

  async function save() {
    setPending(true);
    const result = await request(`/api/businesses/${businessId}/gateways/${gateway.id}`, "PATCH", {
      chargePercent: Number(percent),
    });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(`${gateway.name} now keeps ${percent}%`);
    router.refresh();
  }

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{gateway.name}</span>
      <div className="flex items-center gap-2">
        <div className="w-20">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            aria-label={`${gateway.name} charge %`}
            className={`${smallInput} text-right tabular-nums`}
          />
        </div>
        <span className="text-xs text-neutral-500">%</span>
        {dirty && (
          <Button size="sm" onClick={save} loading={pending}>
            Save
          </Button>
        )}
        <DeleteButton url={`/api/businesses/${businessId}/gateways/${gateway.id}`} label={gateway.name} />
      </div>
    </li>
  );
}
