"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { invoiceTds } from "@/lib/invoiceLines";
import { hintClass, inputClass, labelClass } from "@/components/invoices/LineFields";

/** Rates B2B customers most often deduct at. */
const PRESETS = ["1", "2", "10"];
/** Must match TDS_SECTIONS in src/lib/paymentInput.ts. */
const SECTIONS = ["194J", "194C", "194Q", "194H", "194I", "Other"];

/**
 * TDS the customer will deduct, set on the invoice: a rate on the pre-GST
 * subtotal, printed as "Less: TDS" and filled in when the payment is recorded.
 */
export function TdsFields({
  percent,
  section,
  onPercentChange,
  onSectionChange,
  subTotal,
  total,
}: {
  /** "" = no TDS. */
  percent: string;
  section: string;
  onPercentChange: (v: string) => void;
  onSectionChange: (v: string) => void;
  /** The invoice's total before GST — what TDS is worked out on. */
  subTotal: number;
  /** The invoice's total, GST included. */
  total: number;
}) {
  const [custom, setCustom] = useState(() => percent !== "" && !PRESETS.includes(percent));
  const rate = Number(percent) || 0;
  const tds = invoiceTds(subTotal, rate);

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white px-5 py-4 shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70">
      <p className="flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        <Receipt className="h-4 w-4 text-neutral-400" />
        TDS
        <span className="text-xs font-normal text-neutral-500">optional, when the customer deducts tax at source</span>
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="inv-tdsPercent">
            Customer deducts
          </label>
          <select
            id="inv-tdsPercent"
            className={inputClass}
            value={custom ? "custom" : percent}
            onChange={(e) => {
              const v = e.target.value;
              setCustom(v === "custom");
              onPercentChange(v === "custom" ? percent || "" : v);
            }}
          >
            <option value="">No TDS</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
            <option value="custom">Other rate…</option>
          </select>
        </div>
        {custom && (
          <div>
            <label className={labelClass} htmlFor="inv-tdsCustom">
              Rate (%)
            </label>
            <input
              id="inv-tdsCustom"
              type="number"
              step="0.01"
              min="0"
              max="30"
              inputMode="decimal"
              value={percent}
              onChange={(e) => onPercentChange(e.target.value)}
              className={inputClass}
              placeholder="e.g. 5"
            />
          </div>
        )}
        {rate > 0 && (
          <div>
            <label className={labelClass} htmlFor="inv-tdsSection">
              Section
            </label>
            <select id="inv-tdsSection" className={inputClass} value={section} onChange={(e) => onSectionChange(e.target.value)}>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "Other" ? "Other" : `Section ${s}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className={hintClass}>
        {rate > 0
          ? `Less TDS ${formatCurrency(tds)} (${rate}% of ${formatCurrency(subTotal)} before GST) — the customer pays ${formatCurrency(
              Math.max(0, total - tds)
            )}. Printed on the invoice and filled in when you record the payment.`
          : "Pick the rate the customer deducts and the invoice shows “Less: TDS” and the reduced balance due."}
      </p>
    </div>
  );
}
