import type { ReactNode } from "react";
import { Receipt } from "lucide-react";
import { computeInvoice, type LineInput } from "@/lib/invoiceLines";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

/** Rates present on the invoice, for the CGST/SGST/IGST labels ("9%", or "mixed rates"). */
function rateLabel(rates: number[], split: boolean): string {
  const unique = [...new Set(rates.filter((r) => r > 0))];
  if (unique.length === 0) return "";
  if (unique.length > 1) return " · mixed rates";
  return ` (${split ? unique[0] / 2 : unique[0]}%)`;
}

/**
 * The live "what will this invoice say" card beside the new/edit forms: the
 * buyer's state and supply type, then the tax exactly as the document will
 * compute it — per line, at each line's own rate.
 */
export function LineBreakupPreview({
  lines,
  gstRegistered,
  interState,
  stateLabel,
  footer,
}: {
  lines: LineInput[];
  gstRegistered: boolean;
  interState: boolean;
  /** e.g. "Maharashtra (27) · Inter-state · IGST" */
  stateLabel?: string;
  footer?: ReactNode;
}) {
  const valid = lines.filter((l) => l.grossAmount > 0);
  const t = computeInvoice(valid.length ? valid : [], { isInterState: gstRegistered && interState, gstRegistered });
  const rates = valid.map((l) => l.gstPercent);

  return (
    <Card className="border-brand-100 dark:border-brand-950">
      <CardHeader className="flex items-center gap-2">
        <Receipt className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{gstRegistered ? "Breakup preview" : "Summary"}</h3>
      </CardHeader>
      <CardBody>
        {gstRegistered && stateLabel && (
          <p
            className={`mb-3 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              interState
                ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {stateLabel}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
          {gstRegistered && (
            <>
              <dt>Taxable value</dt>
              <dd className="text-right tabular-nums">{formatCurrency(t.subTotal)}</dd>
              {t.taxMode === "IGST" ? (
                <>
                  <dt>IGST{rateLabel(rates, false)}</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(t.igst)}</dd>
                </>
              ) : (
                <>
                  <dt>CGST{rateLabel(rates, true)}</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(t.cgst)}</dd>
                  <dt>SGST{rateLabel(rates, true)}</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(t.sgst)}</dd>
                </>
              )}
              {t.adjustment !== 0 && (
                <>
                  <dt>Rounding</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(t.adjustment)}</dd>
                </>
              )}
            </>
          )}
          <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
            Total
          </dt>
          <dd className="border-t border-neutral-100 pt-2 text-right font-semibold tabular-nums text-emerald-600 dark:border-white/[0.06] dark:text-emerald-400">
            {formatCurrency(t.total)}
          </dd>
        </dl>
        {gstRegistered && t.hsnSummary.length > 1 && (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t.hsnSummary.length} HSN/rate groups — the invoice lists each in its HSN summary.
          </p>
        )}
        {t.total > 0 && <p className="mt-3 text-xs italic text-neutral-500 dark:text-neutral-400">{amountInWords(t.total)}</p>}
        {footer}
      </CardBody>
    </Card>
  );
}
