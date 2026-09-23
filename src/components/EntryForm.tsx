"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Receipt, Upload } from "lucide-react";
import { calculateBreakup, calculateCostBreakup } from "@/lib/calc";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

export type EntryBusiness = {
  id: string;
  name: string;
  color: string;
  defaultGstPercent: number;
  gateways: { id: string; name: string; chargePercent: number }[];
  categories: { id: string; name: string }[];
};

export type ExistingEntry = {
  id: string;
  businessId: string;
  categoryId: string;
  gatewayId: string | null;
  description: string | null;
  date: string;
  grossAmount: number;
  gstPercent: number;
  screenshotPath: string | null;
  direction: string;
};

/**
 * One money-in or money-out entry. The business comes from the sidebar
 * switcher; the picker only appears when "All businesses" is selected (or when
 * editing, where it stays fixed). Categories and gateways are the chosen
 * business's own.
 */
export function EntryForm({
  businesses,
  expense,
}: {
  businesses: EntryBusiness[];
  expense?: ExistingEntry;
}) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!expense;

  const [businessId, setBusinessId] = useState(expense?.businessId ?? businesses[0]?.id ?? "");
  const business = businesses.find((c) => c.id === businessId);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? business?.categories[0]?.id ?? "");

  const [gatewayId, setGatewayId] = useState<string>(expense?.gatewayId ?? "");
  const [grossAmount, setGrossAmount] = useState<string>(
    expense ? String(expense.grossAmount) : ""
  );
  const [gstPercent, setGstPercent] = useState<string>(
    String(expense?.gstPercent ?? business?.defaultGstPercent ?? 18)
  );
  const [pending, setPending] = useState(false);
  const [direction, setDirection] = useState<"IN" | "OUT">(expense?.direction === "OUT" ? "OUT" : "IN");
  const [proofName, setProofName] = useState<string | null>(null);
  const isOut = direction === "OUT";

  const gateway = business?.gateways.find((g) => g.id === gatewayId);
  const gatewayChargePercent = isOut ? 0 : (gateway?.chargePercent ?? 0);

  const breakup = calculateBreakup({
    grossAmount: Number(grossAmount) || 0,
    gatewayChargePercent,
    gstPercent: Number(gstPercent) || 0,
  });
  const cost = calculateCostBreakup({ grossAmount: Number(grossAmount) || 0, gstPercent: Number(gstPercent) || 0 });

  function onBusinessChange(id: string) {
    setBusinessId(id);
    setGatewayId("");
    const next = businesses.find((c) => c.id === id);
    setCategoryId(next?.categories[0]?.id ?? "");
    setGstPercent(String(next?.defaultGstPercent ?? 18));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const formData = new FormData(e.currentTarget);
      formData.set("businessId", businessId);
      const url = isEdit ? `/api/entries/${expense.id}` : "/api/entries";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, { method, body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Something went wrong");
        return;
      }
      toast.success(isEdit ? "Entry updated" : isOut ? "Money out recorded" : "Money in recorded");
      router.push("/money");
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  if (businesses.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        You don&apos;t have access to any business yet. Ask an admin to add you to one.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <input type="hidden" name="direction" value={direction} />
      <div className="grid min-w-0 gap-6">
      <div className="grid gap-2 rounded-2xl border sm:grid-cols-2 border-neutral-200/80 bg-white p-1.5 shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70">
        {(
          [
            { key: "IN", label: "Money in", hint: "Received via a gateway — charges and GST come off", icon: ArrowDownLeft, on: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
            { key: "OUT", label: "Money out", hint: "A cost the business paid, GST-inclusive", icon: ArrowUpRight, on: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setDirection(opt.key)}
            aria-pressed={direction === opt.key}
            className={`flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
              direction === opt.key ? `ring-1 ${opt.on}` : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-white/[0.04]"
            }`}
          >
            <opt.icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="block text-sm font-semibold">{opt.label}</span>
              <span className="block text-xs opacity-75">{opt.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <Card>
        <CardBody className="grid gap-4">
          {businesses.length > 1 && !isEdit ? (
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Business</label>
              <select
                value={businessId}
                onChange={(e) => onBusinessChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
              >
                {businesses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                The entry is written into this business&apos;s Google Sheet too.
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <span className="h-2 w-2 rounded-full" style={{ background: business?.color }} />
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{business?.name}</span>
              <span className="text-xs text-neutral-400">· also written to its Google Sheet</span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Category
              </label>
              <select
                name="categoryId"
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
              >
                {business?.categories.length === 0 && <option value="">No categories yet — an admin adds them in Settings → Businesses</option>}
                {business?.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Date
              </label>
              <input
                name="date"
                type="date"
                required
                defaultValue={expense?.date ?? new Date().toISOString().slice(0, 10)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {isOut ? "Amount paid (incl. GST)" : "Gross amount received"}
              </label>
              <input
                name="grossAmount"
                type="number"
                step="0.01"
                min="0"
                required
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
              />
            </div>

            {!isOut && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Payment gateway
              </label>
              <select
                name="gatewayId"
                value={gatewayId}
                onChange={(e) => setGatewayId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
              >
                <option value="">None</option>
                {business?.gateways.map((gw) => (
                  <option key={gw.id} value={gw.id}>
                    {gw.name} ({gw.chargePercent}%)
                  </option>
                ))}
              </select>
            </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                GST %
              </label>
              <input
                name="gstPercent"
                type="number"
                step="0.01"
                min="0"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Screenshot (proof of payment)
              </label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-3 py-2 text-sm text-neutral-500 hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-neutral-400">
                <Upload className="h-4 w-4 shrink-0" />
                <span className={`truncate ${proofName ? "text-neutral-900 dark:text-neutral-100" : ""}`}>
                  {proofName ?? (expense?.screenshotPath ? "Replace the saved proof" : "Choose an image or PDF")}
                </span>
                <input
                  name="screenshot"
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => setProofName(e.target.files?.[0]?.name ?? null)}
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Description (optional)
            </label>
            <input
              name="description"
              type="text"
              defaultValue={expense?.description ?? ""}
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60"
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          {isEdit ? "Save changes" : isOut ? "Save money out" : "Save money in"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/money")}>
          Cancel
        </Button>
      </div>
      </div>

      <Card className="border-brand-100 lg:sticky lg:top-20 dark:border-brand-950">
        <CardBody>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            <Receipt className="h-4 w-4 text-brand-500" />
            Breakup preview
          </h3>
          {isOut ? (
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <dt>Total incl. GST</dt>
              <dd className="text-right tabular-nums">{formatCurrency(Number(grossAmount) || 0)}</dd>
              <dt>GST ({gstPercent || 0}%, input credit)</dt>
              <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">− {formatCurrency(cost.gstAmount)}</dd>
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                Cost excl. GST
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-red-600 dark:border-white/[0.06] dark:text-red-400">
                {formatCurrency(cost.netAmount)}
              </dd>
            </dl>
          ) : (
          <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <dt>Gross amount</dt>
              <dd className="text-right tabular-nums">{formatCurrency(Number(grossAmount) || 0)}</dd>
              <dt>Gateway charge ({gatewayChargePercent}%)</dt>
              <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                − {formatCurrency(breakup.gatewayChargeAmount)}
              </dd>
              <dt>After gateway</dt>
              <dd className="text-right tabular-nums">{formatCurrency(breakup.afterGatewayAmount)}</dd>
              <dt>GST ({gstPercent || 0}%)</dt>
              <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                − {formatCurrency(breakup.gstAmount)}
              </dd>
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                Net revenue
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-emerald-600 dark:border-white/[0.06] dark:text-emerald-400">
                {formatCurrency(breakup.netAmount)}
              </dd>
            </dl>
          )}
        </CardBody>
      </Card>
    </form>
  );
}
