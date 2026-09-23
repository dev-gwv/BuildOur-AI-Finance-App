"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { LineInput } from "@/lib/invoiceLines";
import { FieldError, Rupee, inputClass, labelClass, moneyInputClass, type FieldErrors } from "./LineFields";

export type CatalogEntry = { id: string; amount: number; itemDescription: string; hsnSac: string };

/** A line as typed: strings, so a half-typed number isn't lost. */
export interface EditorLine {
  key: string;
  description: string;
  hsnSac: string;
  qty: string;
  /** Line total, GST included. */
  grossAmount: string;
  gstPercent: string;
  /** The amount came from a Bajaj DO and is authoritative — a catalog pick won't overwrite it. */
  fromDo?: boolean;
  /** Set when the line was picked from the catalog (shows "matched"). */
  catalogId?: string;
}

/** GST rates in use in India (goods and services). */
export const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28];

let seq = 0;
export function newLine(partial: Partial<EditorLine> = {}): EditorLine {
  seq += 1;
  return { key: `l${Date.now()}-${seq}`, description: "", hsnSac: "", qty: "1", grossAmount: "", gstPercent: "18", ...partial };
}

export function lineFromStored(l: { description: string; hsnSac: string; qty: number; grossAmount: number; gstPercent: number }): EditorLine {
  return newLine({
    description: l.description,
    hsnSac: l.hsnSac,
    qty: String(l.qty),
    grossAmount: String(l.grossAmount),
    gstPercent: String(l.gstPercent),
  });
}

/** Typed lines -> numbers for maths and the API (unregistered sellers: rate 0). */
export function toLineInputs(lines: EditorLine[], gstRegistered = true): LineInput[] {
  return lines.map((l) => ({
    description: l.description.trim(),
    hsnSac: l.hsnSac.trim(),
    qty: Number(l.qty) || 0,
    grossAmount: Math.round((Number(l.grossAmount) || 0) * 100) / 100,
    gstPercent: gstRegistered ? Number(l.gstPercent) || 0 : 0,
  }));
}

/** Client-side check with the same field keys the API returns ("lines.0.grossAmount"). */
export function lineErrors(lines: EditorLine[], gstRegistered: boolean): FieldErrors {
  const errors: FieldErrors = {};
  lines.forEach((l, i) => {
    if (!l.description.trim()) errors[`lines.${i}.description`] = "Describe the item";
    if (gstRegistered && !l.hsnSac.trim()) errors[`lines.${i}.hsnSac`] = "HSN/SAC is required on a tax invoice";
    if (!(Number(l.qty) > 0)) errors[`lines.${i}.qty`] = "More than 0";
    if (!(Number(l.grossAmount) > 0)) errors[`lines.${i}.grossAmount`] = "Enter the amount";
  });
  return errors;
}

export function LineItemsEditor({
  lines,
  onChange,
  catalog = [],
  gstRegistered,
  errors = {},
  onFieldEdit,
  fieldProps,
}: {
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  catalog?: CatalogEntry[];
  /** Unregistered sellers (Mulberry) have no HSN or GST columns. */
  gstRegistered: boolean;
  errors?: FieldErrors;
  /** Called with a field key when it's edited, so its error can clear. */
  onFieldEdit?: (key: string) => void;
  fieldProps: (name: string) => Record<string, unknown>;
}) {
  const update = (i: number, patch: Partial<EditorLine>, field?: string) => {
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    if (field) onFieldEdit?.(`lines.${i}.${field}`);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines);
  const pick = (i: number, catalogId: string) => {
    const entry = catalog.find((c) => c.id === catalogId);
    if (!entry) return update(i, { catalogId: undefined });
    const line = lines[i];
    update(i, {
      catalogId,
      description: entry.itemDescription,
      hsnSac: entry.hsnSac,
      // A DO's own amount is authoritative; otherwise the list price is a starting point.
      ...(line.fromDo && Number(line.grossAmount) > 0 ? {} : { grossAmount: String(entry.amount) }),
    });
    ["description", "hsnSac", "grossAmount"].forEach((f) => onFieldEdit?.(`lines.${i}.${f}`));
  };

  const total = toLineInputs(lines, gstRegistered).reduce((s, l) => s + l.grossAmount, 0);
  const err = (i: number, f: string) => errors[`lines.${i}.${f}`];
  const cell = (i: number, f: string) => ({ ...fieldProps(`lines.${i}.${f}`) });

  return (
    <div className="grid gap-3">
      <ol className="grid gap-3">
        {lines.map((line, i) => (
          <li
            key={line.key}
            className="rounded-xl border border-neutral-200/80 bg-neutral-50/40 p-3 dark:border-white/[0.07] dark:bg-white/[0.02]"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Item {i + 1}
                {line.catalogId && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] normal-case tracking-normal text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    from catalog
                  </span>
                )}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move item ${i + 1} up`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200/60 disabled:opacity-30 dark:hover:bg-white/10"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === lines.length - 1}
                  aria-label={`Move item ${i + 1} down`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200/60 disabled:opacity-30 dark:hover:bg-white/10"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={lines.length === 1}
                  aria-label={`Remove item ${i + 1}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {catalog.length > 0 && (
              <div className="mb-2">
                <label className="sr-only" htmlFor={`line-${i}-catalog`}>
                  Pick item {i + 1} from the catalog
                </label>
                <select
                  id={`line-${i}-catalog`}
                  value={line.catalogId ?? ""}
                  onChange={(e) => pick(i, e.target.value)}
                  className={`${inputClass} mt-0`}
                >
                  <option value="">Pick a product from the catalog…</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.itemDescription} — {formatCurrency(c.amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-12">
              <div className="sm:col-span-12">
                <label className={labelClass} htmlFor={`desc-${i}`}>
                  Description
                </label>
                <input
                  id={`desc-${i}`}
                  value={line.description}
                  onChange={(e) => update(i, { description: e.target.value, catalogId: undefined }, "description")}
                  placeholder={gstRegistered ? "e.g. Diamond Premium 2.0" : "e.g. Wedding photography package"}
                  className={inputClass}
                  {...cell(i, "description")}
                />
                <FieldError id={`err-lines.${i}.description`} message={err(i, "description")} />
              </div>
              {gstRegistered && (
                <div className="sm:col-span-3">
                  <label className={labelClass} htmlFor={`hsn-${i}`}>
                    HSN/SAC
                  </label>
                  <input
                    id={`hsn-${i}`}
                    value={line.hsnSac}
                    onChange={(e) => update(i, { hsnSac: e.target.value }, "hsnSac")}
                    inputMode="numeric"
                    className={`${inputClass} tabular-nums`}
                    {...cell(i, "hsnSac")}
                  />
                  <FieldError id={`err-lines.${i}.hsnSac`} message={err(i, "hsnSac")} />
                </div>
              )}
              <div className={gstRegistered ? "sm:col-span-2" : "sm:col-span-3"}>
                <label className={labelClass} htmlFor={`qty-${i}`}>
                  Qty
                </label>
                <input
                  id={`qty-${i}`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={line.qty}
                  onChange={(e) => update(i, { qty: e.target.value }, "qty")}
                  className={`${inputClass} tabular-nums`}
                  {...cell(i, "qty")}
                />
                <FieldError id={`err-lines.${i}.qty`} message={err(i, "qty")} />
              </div>
              <div className={gstRegistered ? "sm:col-span-4" : "sm:col-span-9"}>
                <label className={labelClass} htmlFor={`amt-${i}`}>
                  Amount{gstRegistered ? " incl. GST" : ""}
                </label>
                <Rupee>
                  <input
                    id={`amt-${i}`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={line.grossAmount}
                    onChange={(e) => update(i, { grossAmount: e.target.value, fromDo: false }, "grossAmount")}
                    className={`${moneyInputClass} font-semibold`}
                    {...cell(i, "grossAmount")}
                  />
                </Rupee>
                <FieldError id={`err-lines.${i}.grossAmount`} message={err(i, "grossAmount")} />
              </div>
              {gstRegistered && (
                <div className="sm:col-span-3">
                  <label className={labelClass} htmlFor={`gst-${i}`}>
                    GST %
                  </label>
                  <select
                    id={`gst-${i}`}
                    value={line.gstPercent}
                    onChange={(e) => update(i, { gstPercent: e.target.value }, "gstPercent")}
                    className={`${inputClass} tabular-nums`}
                    {...cell(i, "gstPercent")}
                  >
                    {[...new Set([...GST_RATES, Number(line.gstPercent) || 0])]
                      .sort((a, b) => a - b)
                      .map((r) => (
                        <option key={r} value={String(r)}>
                          {r}%
                        </option>
                      ))}
                  </select>
                  <FieldError id={`err-lines.${i}.gstPercent`} message={err(i, "gstPercent")} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange([...lines, newLine({ gstPercent: gstRegistered ? lines[lines.length - 1]?.gstPercent ?? "18" : "0" })])}
          disabled={lines.length >= 50}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-40 dark:border-white/15 dark:text-neutral-300 dark:hover:text-brand-300"
        >
          <Plus className="h-4 w-4" />
          Add line
        </button>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {lines.length} item{lines.length === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">{formatCurrency(total)}</span>
        </p>
      </div>
    </div>
  );
}
