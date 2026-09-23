"use client";

import { todayISO } from "@/lib/dates";
import { useId, useState, type FormEvent } from "react";
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

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-xs outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";
const hintClass = "mt-1 text-xs text-neutral-500 dark:text-neutral-400";

/** The GST slabs a cost is usually billed at; 0 is "No GST". */
const GST_PRESETS = [0, 5, 12, 18, 28];

/**
 * One money-in or money-out entry. Money out is an expense: it starts with
 * what it was for, typed freely. The category is optional and typeable —
 * pick one of the business's or type a new one and it's created on save.
 * The business comes from the sidebar switcher; the picker only appears when
 * "All businesses" is selected.
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
  const listId = useId();
  const isEdit = !!expense;

  const [businessId, setBusinessId] = useState(expense?.businessId ?? businesses[0]?.id ?? "");
  const business = businesses.find((c) => c.id === businessId);
  const [direction, setDirection] = useState<"IN" | "OUT">(expense?.direction === "OUT" ? "OUT" : "IN");
  const isOut = direction === "OUT";

  const [description, setDescription] = useState(expense?.description ?? "");
  const [categoryName, setCategoryName] = useState(
    () => business?.categories.find((c) => c.id === expense?.categoryId)?.name ?? ""
  );
  const [gatewayId, setGatewayId] = useState<string>(expense?.gatewayId ?? "");
  const [grossAmount, setGrossAmount] = useState<string>(expense ? String(expense.grossAmount) : "");
  const [gstPercent, setGstPercent] = useState<string>(String(expense?.gstPercent ?? business?.defaultGstPercent ?? 18));
  const [pending, setPending] = useState(false);
  const [proofName, setProofName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A field's message goes as soon as the user starts correcting it.
  const clearError = (name: string) =>
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });

  const gateway = business?.gateways.find((g) => g.id === gatewayId);
  const gatewayChargePercent = isOut ? 0 : (gateway?.chargePercent ?? 0);
  const breakup = calculateBreakup({ grossAmount: Number(grossAmount) || 0, gatewayChargePercent, gstPercent: Number(gstPercent) || 0 });
  const cost = calculateCostBreakup({ grossAmount: Number(grossAmount) || 0, gstPercent: Number(gstPercent) || 0 });

  const trimmedCategory = categoryName.trim();
  const isNewCategory =
    trimmedCategory !== "" && !business?.categories.some((c) => c.name.toLowerCase() === trimmedCategory.toLowerCase());

  function onBusinessChange(id: string) {
    setBusinessId(id);
    setGatewayId("");
    setCategoryName("");
    const next = businesses.find((c) => c.id === id);
    setGstPercent(String(next?.defaultGstPercent ?? 18));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const clientErrors: Record<string, string> = {};
    if (isOut && !description.trim()) clientErrors.description = "Say what the expense was for";
    if (!(Number(grossAmount) > 0)) clientErrors.grossAmount = "Enter an amount greater than zero";
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      toast.error(Object.values(clientErrors)[0]);
      return;
    }

    setPending(true);
    try {
      const formData = new FormData(e.currentTarget);
      formData.set("businessId", businessId);
      formData.set("categoryName", trimmedCategory);
      const url = isEdit ? `/api/entries/${expense.id}` : "/api/entries";
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrors(body.fields ?? {});
        toast.error(body.error ?? "Something went wrong");
        return;
      }
      toast.success(isEdit ? "Entry updated" : isOut ? "Expense recorded" : "Money in recorded");
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

  const fieldError = (name: string) =>
    errors[name] ? <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors[name]}</p> : null;

  const amountAndDate = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="entry-amount" className={labelClass}>
          {isOut ? "Amount paid (incl. GST)" : "Gross amount received"}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-sm text-neutral-400">₹</span>
          <input
            id="entry-amount"
            name="grossAmount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            value={grossAmount}
            onChange={(e) => {
              setGrossAmount(e.target.value);
              clearError("grossAmount");
            }}
            placeholder="0.00"
            className={`${inputClass} pl-7 tabular-nums`}
          />
        </div>
        {fieldError("grossAmount")}
      </div>
      <div>
        <label htmlFor="entry-date" className={labelClass}>
          Date
        </label>
        <input
          id="entry-date"
          name="date"
          type="date"
          required
          defaultValue={expense?.date ?? todayISO()}
          onChange={() => clearError("date")}
          className={inputClass}
        />
        {fieldError("date")}
      </div>
    </div>
  );

  const gstField = (
    <div>
      <label htmlFor="entry-gst" className={labelClass}>
        GST %
      </label>
      <input
        id="entry-gst"
        name="gstPercent"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        max="100"
        value={gstPercent}
        onChange={(e) => {
          setGstPercent(e.target.value);
          clearError("gstPercent");
        }}
        className={`${inputClass} tabular-nums`}
      />
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Common GST rates">
        {GST_PRESETS.map((rate) => {
          const active = Number(gstPercent) === rate && gstPercent !== "";
          return (
            <button
              key={rate}
              type="button"
              onClick={() => {
                setGstPercent(String(rate));
                clearError("gstPercent");
              }}
              aria-pressed={active}
              className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                active
                  ? "bg-neutral-900 text-white ring-neutral-900 dark:bg-white dark:text-neutral-900 dark:ring-white"
                  : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50 dark:bg-white/[0.03] dark:text-neutral-300 dark:ring-white/10 dark:hover:bg-white/[0.06]"
              }`}
            >
              {rate === 0 ? "No GST" : `${rate}%`}
            </button>
          );
        })}
      </div>
      {fieldError("gstPercent")}
    </div>
  );

  const categoryField = (
    <div>
      <label htmlFor="entry-category" className={labelClass}>
        Category <span className="font-normal text-neutral-400">(optional)</span>
      </label>
      <input
        id="entry-category"
        type="text"
        list={listId}
        value={categoryName}
        onChange={(e) => {
          setCategoryName(e.target.value);
          clearError("categoryName");
        }}
        maxLength={60}
        autoComplete="off"
        placeholder={isOut ? "e.g. Rent, Travel, Salaries" : "e.g. Course sales"}
        className={inputClass}
      />
      <datalist id={listId}>
        {business?.categories.map((cat) => (
          <option key={cat.id} value={cat.name} />
        ))}
      </datalist>
      <p className={hintClass}>
        {isNewCategory
          ? `"${trimmedCategory}" is new — it'll be added to ${business?.name}'s categories.`
          : trimmedCategory
            ? "Groups this entry in reports and the dashboard."
            : "Pick one or type a new one. Left empty, it goes under General."}
      </p>
      {fieldError("categoryName")}
    </div>
  );

  const proofField = (
    <div>
      <span className={labelClass}>{isOut ? "Bill or receipt" : "Proof of payment"}</span>
      <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-3 py-2 text-sm text-neutral-500 hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-neutral-400">
        <Upload className="h-4 w-4 shrink-0" />
        <span className={`truncate ${proofName ? "text-neutral-900 dark:text-neutral-100" : ""}`}>
          {proofName ?? (expense?.screenshotPath ? "Replace the saved proof" : "Choose an image or PDF")}
        </span>
        <input
          name="screenshot"
          type="file"
          accept="image/*,.pdf"
          className="sr-only"
          onChange={(e) => setProofName(e.target.files?.[0]?.name ?? null)}
        />
      </label>
    </div>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <input type="hidden" name="direction" value={direction} />
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-2 rounded-2xl border border-neutral-200/80 bg-white p-1.5 shadow-card sm:grid-cols-2 dark:border-white/[0.07] dark:bg-neutral-900/70">
          {(
            [
              { key: "IN", label: "Money in", hint: "Received via a gateway — charges and GST come off", icon: ArrowDownLeft, on: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
              { key: "OUT", label: "Money out", hint: "An expense the business paid, GST-inclusive", icon: ArrowUpRight, on: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setDirection(opt.key);
                setErrors({});
              }}
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
          <CardBody className="grid gap-5">
            {businesses.length > 1 && !isEdit ? (
              <div>
                <label htmlFor="entry-business" className={labelClass}>
                  Business
                </label>
                <select id="entry-business" value={businessId} onChange={(e) => onBusinessChange(e.target.value)} className={inputClass}>
                  {businesses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className={hintClass}>The entry is written into this business&apos;s Google Sheet too.</p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span className="h-2 w-2 rounded-full" style={{ background: business?.color }} />
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{business?.name}</span>
                <span className="text-xs text-neutral-400">· also written to its Google Sheet</span>
              </p>
            )}

            <div>
              <label htmlFor="entry-description" className={labelClass}>
                {isOut ? "Expense" : "Description"}
                {!isOut && <span className="font-normal text-neutral-400"> (optional)</span>}
              </label>
              <input
                id="entry-description"
                name="description"
                type="text"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError("description");
                }}
                maxLength={500}
                required={isOut}
                autoFocus={!isEdit}
                aria-invalid={Boolean(errors.description)}
                placeholder={isOut ? "What was it for? e.g. Office rent — September, Printer ink" : "e.g. TagMango course sale"}
                className={`${inputClass} ${isOut ? "text-base font-medium sm:text-sm" : ""}`}
              />
              {fieldError("description")}
            </div>

            {amountAndDate}

            {isOut ? (
              <>
                {gstField}
                <div className="grid gap-4 sm:grid-cols-2">
                  {categoryField}
                  {proofField}
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="entry-gateway" className={labelClass}>
                      Payment gateway
                    </label>
                    <select id="entry-gateway" name="gatewayId" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} className={inputClass}>
                      <option value="">None</option>
                      {business?.gateways.map((gw) => (
                        <option key={gw.id} value={gw.id}>
                          {gw.name} ({gw.chargePercent}%)
                        </option>
                      ))}
                    </select>
                  </div>
                  {gstField}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {categoryField}
                  {proofField}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={pending}>
            {isEdit ? "Save changes" : isOut ? "Save expense" : "Save money in"}
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
              {description.trim() && (
                <>
                  <dt className="col-span-2 truncate font-medium text-neutral-900 dark:text-neutral-100">{description.trim()}</dt>
                </>
              )}
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
              <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">− {formatCurrency(breakup.gatewayChargeAmount)}</dd>
              <dt>After gateway</dt>
              <dd className="text-right tabular-nums">{formatCurrency(breakup.afterGatewayAmount)}</dd>
              <dt>GST ({gstPercent || 0}%)</dt>
              <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">− {formatCurrency(breakup.gstAmount)}</dd>
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
