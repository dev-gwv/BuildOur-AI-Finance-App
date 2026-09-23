import { CheckCircle2 } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import { isInterStateSupply } from "@/lib/gstState";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency, formatDate } from "@/lib/format";
import { BRANDS, type BrandKey } from "@/lib/brands";
import { AUTHORIZED_SIGNATURE_DATA_URI } from "@/lib/signatureImage";

export interface InvoiceDocumentData {
  brand?: BrandKey;
  invoiceNumber: string;
  invoiceDate: string | Date;
  dueDate: string | Date;
  customerName: string;
  customerAddress: string;
  customerGstin?: string | null;
  placeOfSupply: string;
  itemDescription: string;
  hsnSac: string;
  qty: number;
  grossAmount: number;
  gstPercent: number;
  notes: string | null;
  terms: string | null;
  doId?: string | null;
  /** Set when edited after being emailed; the document then says it's a revision. */
  revisedAt?: string | Date | null;
}

export interface PaymentLine {
  id: string;
  amount: number;
  paidOn: string | Date;
  method: string | null;
}

// Deliberately always rendered light, regardless of the app's dark mode —
// this is a formal document meant to look identical on screen and in print.
export function InvoiceDocument({
  invoice,
  signatureDataUri,
  payments = [],
}: {
  invoice: InvoiceDocumentData;
  /** Uploaded in Invoice Settings; falls back to the signature already in use. */
  signatureDataUri?: string | null;
  payments?: PaymentLine[];
}) {
  const brand = BRANDS[invoice.brand ?? "GRATEFUL"];
  const signature = signatureDataUri || AUTHORIZED_SIGNATURE_DATA_URI;

  // GSTIN first 2 digits decide the tax mode: same state (07 Delhi) -> CGST+SGST,
  // other state -> IGST. No GSTIN (B2C) stays intra-state. Mulberry is unregistered.
  const isInterState = brand.gstRegistered ? isInterStateSupply(invoice.customerGstin) : false;

  const breakup = calculateInvoiceBreakup({
    grossAmount: invoice.grossAmount,
    gstPercent: brand.gstRegistered ? invoice.gstPercent : 0,
    qty: invoice.qty,
    isInterState,
  });

  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = Math.round((invoice.grossAmount - paidAmount) * 100) / 100;
  const settled = balanceDue <= 0;

  return (
    <div id="invoice-print-area" className="mx-auto max-w-[860px] bg-white text-neutral-900 print:max-w-none">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 shadow-lg print:rounded-none print:border-0 print:shadow-none">
        <div className={`flex flex-col gap-6 px-8 py-8 text-white sm:flex-row sm:items-start sm:justify-between ${brand.headerClass}`}>
          <div className="flex items-start gap-4">
            {brand.logoDataUri && (
              // eslint-disable-next-line @next/next/no-img-element -- inline data URI
              <img
                src={brand.logoDataUri}
                alt={brand.name}
                className="h-20 w-20 shrink-0 rounded-lg object-cover shadow-md"
              />
            )}
            <div>
              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${brand.accentTextClass}`}>
                {brand.documentTitle}
                {invoice.revisedAt && (
                  <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 tracking-normal normal-case">
                    Revised {formatDate(invoice.revisedAt)}
                  </span>
                )}
              </p>
              <h1 className="mt-1 text-2xl font-bold">{brand.name}</h1>
              {brand.addressLines.map((line) => (
                <p key={line} className="text-sm text-white/80">
                  {line}
                </p>
              ))}
              {brand.gstRegistered && (
                <p className="mt-1 text-sm text-white/80">
                  GSTIN {brand.gstin} · CIN {brand.companyId}
                </p>
              )}
            </div>
          </div>
          <div className="sm:text-right">
            {settled ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Paid in full
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                Balance due {formatCurrency(balanceDue)}
              </div>
            )}
            <p className="mt-3 text-3xl font-bold tracking-tight">#{invoice.invoiceNumber}</p>
          </div>
        </div>

        <div className="grid gap-8 px-8 py-8 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Bill to</p>
            <p className="mt-1 text-base font-semibold text-neutral-900">{invoice.customerName}</p>
            <p className="mt-1 max-w-xs text-sm text-neutral-600">{invoice.customerAddress}</p>
            <p className="mt-1 text-sm text-neutral-600">India</p>
            {invoice.customerGstin && (
              <p className="mt-1 text-sm font-medium text-neutral-700">GSTIN {invoice.customerGstin}</p>
            )}
          </div>
          <div className="sm:text-right">
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm sm:ml-auto sm:max-w-[240px]">
              <dt className="text-neutral-500">Invoice date</dt>
              <dd className="text-right font-medium text-neutral-900">{formatDate(invoice.invoiceDate)}</dd>
              <dt className="text-neutral-500">Due date</dt>
              <dd className="text-right font-medium text-neutral-900">{formatDate(invoice.dueDate)}</dd>
              {brand.gstRegistered && (
                <>
                  <dt className="text-neutral-500">Place of supply</dt>
                  <dd className="text-right font-medium text-neutral-900">{invoice.placeOfSupply}</dd>
                </>
              )}
              {invoice.doId && (
                <>
                  <dt className="text-neutral-500">DO reference</dt>
                  <dd className="text-right font-medium text-neutral-900">{invoice.doId}</dd>
                </>
              )}
            </dl>
          </div>
        </div>

        <div className="overflow-x-auto px-8">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-3 pr-2 font-semibold">#</th>
                <th className="py-3 pr-2 font-semibold">Item &amp; description</th>
                {brand.gstRegistered && <th className="py-3 pr-2 font-semibold">HSN/SAC</th>}
                <th className="py-3 pr-2 text-right font-semibold">Qty</th>
                <th className="py-3 pr-2 text-right font-semibold">Rate</th>
                {brand.gstRegistered && breakup.taxMode === "IGST" && (
                  <th className="py-3 pr-2 text-right font-semibold">IGST</th>
                )}
                {brand.gstRegistered && breakup.taxMode !== "IGST" && (
                  <>
                    <th className="py-3 pr-2 text-right font-semibold">CGST</th>
                    <th className="py-3 pr-2 text-right font-semibold">SGST</th>
                  </>
                )}
                <th className="py-3 pl-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-100">
                <td className="py-4 pr-2 align-top text-neutral-500">1</td>
                <td className="py-4 pr-2 align-top font-medium text-neutral-900">{invoice.itemDescription}</td>
                {brand.gstRegistered && (
                  <td className="py-4 pr-2 align-top text-neutral-600">{invoice.hsnSac}</td>
                )}
                <td className="py-4 pr-2 align-top text-right text-neutral-600">{invoice.qty.toFixed(2)}</td>
                <td className="py-4 pr-2 align-top text-right text-neutral-600">{formatCurrency(breakup.rate)}</td>
                {brand.gstRegistered && breakup.taxMode === "IGST" && (
                  <td className="py-4 pr-2 align-top text-right text-neutral-600">
                    {formatCurrency(breakup.igstAmount)}
                    <br />
                    <span className="text-xs text-neutral-400">{breakup.igstPercent}%</span>
                  </td>
                )}
                {brand.gstRegistered && breakup.taxMode !== "IGST" && (
                  <>
                    <td className="py-4 pr-2 align-top text-right text-neutral-600">
                      {formatCurrency(breakup.cgstAmount)}
                      <br />
                      <span className="text-xs text-neutral-400">{breakup.cgstPercent}%</span>
                    </td>
                    <td className="py-4 pr-2 align-top text-right text-neutral-600">
                      {formatCurrency(breakup.sgstAmount)}
                      <br />
                      <span className="text-xs text-neutral-400">{breakup.sgstPercent}%</span>
                    </td>
                  </>
                )}
                <td className="py-4 pl-2 align-top text-right font-semibold text-neutral-900">
                  {formatCurrency(breakup.subTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-end px-8 pb-2 pt-6 text-sm">
          <div className="w-full max-w-xs space-y-2">
            <div className="flex justify-between text-neutral-600">
              <span>Sub total</span>
              <span className="tabular-nums">{formatCurrency(breakup.subTotal)}</span>
            </div>
            {brand.gstRegistered && (
              <>
                {breakup.taxMode === "IGST" ? (
                  <div className="flex justify-between text-neutral-600">
                    <span>IGST ({breakup.igstPercent}%)</span>
                    <span className="tabular-nums">{formatCurrency(breakup.igstAmount)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-neutral-600">
                      <span>CGST ({breakup.cgstPercent}%)</span>
                      <span className="tabular-nums">{formatCurrency(breakup.cgstAmount)}</span>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <span>SGST ({breakup.sgstPercent}%)</span>
                      <span className="tabular-nums">{formatCurrency(breakup.sgstAmount)}</span>
                    </div>
                  </>
                )}
                {breakup.adjustment !== 0 && (
                  <div className="flex justify-between text-neutral-600">
                    <span>Adjustment</span>
                    <span className="tabular-nums">{formatCurrency(breakup.adjustment)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold text-neutral-900">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(invoice.grossAmount)}</span>
            </div>
            {paidAmount > 0 && (
              <div className="flex justify-between text-neutral-600">
                <span>Payment made</span>
                <span className="tabular-nums text-emerald-600">(-) {formatCurrency(paidAmount)}</span>
              </div>
            )}
            <div
              className={`flex justify-between rounded-lg px-3 py-2 text-base font-bold ${
                settled ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-900"
              }`}
            >
              <span>Balance due</span>
              <span className="tabular-nums">{formatCurrency(Math.max(balanceDue, 0))}</span>
            </div>
          </div>
        </div>

        <div className="mx-8 mt-4 rounded-lg bg-neutral-50 px-4 py-3 text-sm italic text-neutral-600">
          Total in words:{" "}
          <span className="font-semibold not-italic text-neutral-900">{amountInWords(invoice.grossAmount)}</span>
        </div>

        {(invoice.notes || invoice.terms) && (
          <div className="grid gap-4 px-8 py-6 text-sm sm:grid-cols-2">
            {invoice.notes && (
              <div>
                <p className="font-semibold text-neutral-700">Notes</p>
                <p className="mt-1 text-neutral-600">{invoice.notes}</p>
              </div>
            )}
            {invoice.terms && (
              <div>
                <p className="font-semibold text-neutral-700">Terms &amp; conditions</p>
                <p className="mt-1 whitespace-pre-line text-neutral-600">{invoice.terms}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-6 border-t border-neutral-200 px-8 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-sm text-neutral-600">
            {brand.bank ? (
              <>
                <p className="font-semibold text-neutral-700">Bank account details</p>
                <p>Account name: {brand.bank.accountName}</p>
                <p>Account number: {brand.bank.accountNumber}</p>
                <p>
                  IFSC: {brand.bank.ifsc} · {brand.bank.bankName} ({brand.bank.accountType})
                </p>
              </>
            ) : (
              <p className="text-neutral-500">{brand.name}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI, no next/image optimization needed */}
            <img src={signature} alt="Authorized signature" className="ml-auto h-14 w-auto object-contain" />
            <div className="ml-auto w-56 border-b border-neutral-300" />
            <p className="mt-1.5 text-xs font-medium text-neutral-700">Authorised Signatory</p>
            <p className="text-xs text-neutral-500">{brand.name}</p>
          </div>
        </div>

        <p className="border-t border-neutral-100 px-8 py-3 text-center text-[11px] text-neutral-400">
          This is a computer-generated {brand.documentTitle.toLowerCase()} and is valid without a physical stamp.
        </p>
      </div>
    </div>
  );
}
