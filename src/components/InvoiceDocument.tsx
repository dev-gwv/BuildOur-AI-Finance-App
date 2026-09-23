import { CheckCircle2 } from "lucide-react";
import { computeInvoice, invoiceBalance, type LineInput } from "@/lib/invoiceLines";
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
  /**
   * The items (pass `include: { lines: { orderBy: { position: "asc" } } }`).
   * Without them, the summary columns below are printed as one line.
   */
  lines?: LineInput[] | null;
  itemDescription: string;
  hsnSac: string;
  qty: number;
  grossAmount: number;
  gstPercent: number;
  notes: string | null;
  terms: string | null;
  doId?: string | null;
  /** "BAJAJ" when sold on Bajaj Finance EMI: the document says who pays what. */
  saleType?: string | null;
  downPayment?: number | null;
  financedAmount?: number | null;
  /** Set when edited after being emailed; the document then says it's a revision. */
  revisedAt?: string | Date | null;
  /** "CANCELLED" prints a stamp: the number stays in the series but the invoice counts for nothing. */
  status?: string | null;
  cancelledAt?: string | Date | null;
  cancelReason?: string | null;
}

export interface PaymentLine {
  id: string;
  amount: number;
  paidOn: string | Date;
  method: string | null;
  /** "REFUND" for money handed back after a credit note; receipts otherwise. */
  kind?: string | null;
  /** Tax the customer deducted at source (part of `amount`). */
  tdsAmount?: number | null;
}

export interface CreditNoteLine {
  number: string;
  noteDate: string | Date;
  grossAmount: number;
}

const th = "py-3 pr-3 font-semibold";
const thNum = "py-3 pr-3 text-right font-semibold";
const td = "py-3.5 pr-3 align-top text-neutral-600";
const tdNum = "py-3.5 pr-3 align-top text-right tabular-nums text-neutral-600";

/** "9%" for one rate, nothing when lines differ (each line shows its own). */
function uniformRate(lines: LineInput[], split: boolean): string {
  const rates = [...new Set(lines.map((l) => l.gstPercent).filter((r) => r > 0))];
  return rates.length === 1 ? ` (${split ? rates[0] / 2 : rates[0]}%)` : "";
}

// Deliberately always rendered light, regardless of the app's dark mode —
// this is a formal document meant to look identical on screen and in print.
export function InvoiceDocument({
  invoice,
  signatureDataUri,
  payments = [],
  creditNotes = [],
}: {
  invoice: InvoiceDocumentData;
  /** Uploaded in Invoice Settings; falls back to the signature already in use. */
  signatureDataUri?: string | null;
  payments?: PaymentLine[];
  /** Credit notes issued against it; they reduce what's owed. */
  creditNotes?: CreditNoteLine[];
}) {
  const brand = BRANDS[invoice.brand ?? "GRATEFUL"];
  const signature = signatureDataUri || AUTHORIZED_SIGNATURE_DATA_URI;
  const registered = brand.gstRegistered;

  // The GSTIN's state (else the place of supply's) decides CGST+SGST vs IGST.
  const isInterState = registered ? isInterStateSupply(invoice.customerGstin, invoice.placeOfSupply) : false;
  const lines: LineInput[] = invoice.lines?.length
    ? invoice.lines
    : [{ description: invoice.itemDescription, hsnSac: invoice.hsnSac, qty: invoice.qty, grossAmount: invoice.grossAmount, gstPercent: invoice.gstPercent }];
  const t = computeInvoice(lines, { isInterState, gstRegistered: registered });
  const igst = t.taxMode === "IGST";
  const taxed = registered && t.taxMode !== "NONE";

  const bal = invoiceBalance({ grossAmount: invoice.grossAmount, status: invoice.status ?? "ISSUED", creditNotes, payments });
  const netReceived = Math.round((bal.received - bal.refunded) * 100) / 100;
  // A Bajaj EMI sale: the customer pays the down payment, Bajaj Finance the rest.
  const isBajaj = invoice.saleType === "BAJAJ";
  const financed = isBajaj ? (invoice.financedAmount ?? invoice.grossAmount - (invoice.downPayment ?? 0)) : 0;
  const bajajPending = isBajaj && !payments.some((p) => p.method === "Bajaj Finance disbursement");
  const cancelled = bal.cancelled;

  return (
    <div id="invoice-print-area" data-light-surface className="mx-auto max-w-[900px] bg-white text-neutral-900 print:max-w-none">
      <div className="relative overflow-hidden rounded-2xl border border-neutral-200 shadow-lg print:rounded-none print:border-0 print:shadow-none">
        {cancelled && (
          // The stamp sits over the whole document, including in print, so a
          // cancelled invoice can never pass for a live one.
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="-rotate-[24deg] rounded-xl border-[6px] border-red-600/70 px-8 py-3 text-5xl font-black uppercase tracking-[0.2em] text-red-600/70 sm:text-7xl">
              Cancelled
            </span>
          </div>
        )}

        <div className={`flex flex-col gap-6 px-8 py-8 text-white sm:flex-row sm:items-start sm:justify-between ${brand.headerClass}`}>
          <div className="flex min-w-0 flex-1 items-start gap-4">
            {brand.logoDataUri && (
              // eslint-disable-next-line @next/next/no-img-element -- inline data URI
              <img src={brand.logoDataUri} alt={brand.name} className="h-20 w-20 shrink-0 rounded-lg object-cover shadow-md" />
            )}
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${brand.accentTextClass}`}>
                {brand.documentTitle}
                {invoice.revisedAt && !cancelled && (
                  <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 tracking-normal normal-case">Revised {formatDate(invoice.revisedAt)}</span>
                )}
              </p>
              <h1 className="mt-1 text-xl font-bold leading-snug sm:text-2xl">{brand.name}</h1>
              {brand.addressLines.map((line) => (
                <p key={line} className="text-sm text-white/80">
                  {line}
                </p>
              ))}
              {registered && (
                <p className="mt-1 text-sm text-white/80">
                  GSTIN {brand.gstin} · CIN {brand.companyId}
                </p>
              )}
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            {cancelled ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">Cancelled</div>
            ) : bal.settled && bal.toRefund <= 0.5 ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Paid in full
              </div>
            ) : bal.toRefund > 0.5 ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                Refund due {formatCurrency(bal.toRefund)}
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                Balance due {formatCurrency(bal.balance)}
              </div>
            )}
            <p className="mt-3 whitespace-nowrap text-2xl font-bold tracking-tight tabular-nums sm:text-[28px]">#{invoice.invoiceNumber}</p>
          </div>
        </div>

        {cancelled && (
          <div className="border-b border-red-100 bg-red-50 px-8 py-3 text-sm text-red-800">
            <span className="font-semibold">This invoice was cancelled</span>
            {invoice.cancelledAt && ` on ${formatDate(invoice.cancelledAt)}`}
            {invoice.cancelReason && ` — ${invoice.cancelReason}`}. Nothing is payable against it.
          </div>
        )}

        <div className="grid gap-8 px-8 py-8 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Bill to</p>
            <p className="mt-1 text-base font-semibold text-neutral-900">{invoice.customerName}</p>
            {invoice.customerAddress && <p className="mt-1 max-w-xs whitespace-pre-line text-sm text-neutral-600">{invoice.customerAddress}</p>}
            <p className="mt-1 text-sm text-neutral-600">India</p>
            {invoice.customerGstin && <p className="mt-1 text-sm font-medium text-neutral-700">GSTIN {invoice.customerGstin}</p>}
          </div>
          <div className="sm:text-right">
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm sm:ml-auto sm:max-w-[260px]">
              <dt className="text-neutral-500">Invoice date</dt>
              <dd className="text-right font-medium text-neutral-900">{formatDate(invoice.invoiceDate)}</dd>
              <dt className="text-neutral-500">Due date</dt>
              <dd className="text-right font-medium text-neutral-900">{formatDate(invoice.dueDate)}</dd>
              {registered && (
                <>
                  <dt className="text-neutral-500">Place of supply</dt>
                  <dd className="text-right font-medium text-neutral-900">{invoice.placeOfSupply}</dd>
                </>
              )}
              {invoice.doId && (
                <>
                  <dt className="text-neutral-500">{isBajaj ? "Bajaj Finance DO" : "DO reference"}</dt>
                  <dd className="text-right font-medium text-neutral-900">{invoice.doId}</dd>
                </>
              )}
            </dl>
          </div>
        </div>

        {/* Phones: each line as a stacked card — a 9-column table can't be read
            at 390px. Screens and print always get the full table. */}
        <div className="grid gap-3 px-6 sm:hidden print:hidden">
          {t.lines.map((l, i) => (
            <div key={i} className="rounded-xl border border-neutral-200">
              <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900">
                    <span className="mr-1.5 text-neutral-500">{i + 1}.</span>
                    {l.description}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {l.qty} × {formatCurrency(l.breakup.rate)}
                    {registered && l.hsnSac ? ` · HSN/SAC ${l.hsnSac}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums text-neutral-900">{formatCurrency(l.grossAmount)}</p>
              </div>
              {taxed && (
                <dl className="grid gap-1 px-4 py-3 text-xs text-neutral-600">
                  <div className="flex justify-between">
                    <dt>Taxable value</dt>
                    <dd className="tabular-nums">{formatCurrency(l.breakup.subTotal)}</dd>
                  </div>
                  {igst ? (
                    <div className="flex justify-between">
                      <dt>IGST {l.breakup.igstPercent}%</dt>
                      <dd className="tabular-nums">{formatCurrency(l.breakup.igstAmount)}</dd>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <dt>CGST {l.breakup.cgstPercent}%</dt>
                        <dd className="tabular-nums">{formatCurrency(l.breakup.cgstAmount)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>SGST {l.breakup.sgstPercent}%</dt>
                        <dd className="tabular-nums">{formatCurrency(l.breakup.sgstAmount)}</dd>
                      </div>
                    </>
                  )}
                </dl>
              )}
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto px-8 sm:block print:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className={th}>#</th>
                <th className={th}>Item &amp; description</th>
                {registered && <th className={th}>HSN/SAC</th>}
                <th className={thNum}>Qty</th>
                <th className={thNum}>Rate</th>
                {taxed && <th className={thNum}>Taxable</th>}
                {taxed && igst && <th className={thNum}>IGST</th>}
                {taxed && !igst && (
                  <>
                    <th className={thNum}>CGST</th>
                    <th className={thNum}>SGST</th>
                  </>
                )}
                <th className="py-3 pl-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className={`${td} text-neutral-500`}>{i + 1}</td>
                  <td className={`${td} font-medium text-neutral-900`}>{l.description}</td>
                  {registered && <td className={td}>{l.hsnSac}</td>}
                  <td className={tdNum}>{l.qty}</td>
                  <td className={tdNum}>{formatCurrency(l.breakup.rate)}</td>
                  {taxed && <td className={tdNum}>{formatCurrency(l.breakup.subTotal)}</td>}
                  {taxed && igst && (
                    <td className={tdNum}>
                      {formatCurrency(l.breakup.igstAmount)}
                      <br />
                      <span className="text-xs text-neutral-500">{l.breakup.igstPercent}%</span>
                    </td>
                  )}
                  {taxed && !igst && (
                    <>
                      <td className={tdNum}>
                        {formatCurrency(l.breakup.cgstAmount)}
                        <br />
                        <span className="text-xs text-neutral-500">{l.breakup.cgstPercent}%</span>
                      </td>
                      <td className={tdNum}>
                        {formatCurrency(l.breakup.sgstAmount)}
                        <br />
                        <span className="text-xs text-neutral-500">{l.breakup.sgstPercent}%</span>
                      </td>
                    </>
                  )}
                  <td className="py-3.5 pl-2 text-right align-top font-semibold tabular-nums text-neutral-900">{formatCurrency(l.grossAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-end px-8 pb-2 pt-6 text-sm">
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-neutral-600">
              <span>{taxed ? "Taxable value" : "Sub total"}</span>
              <span className="tabular-nums">{formatCurrency(taxed ? t.subTotal : t.total)}</span>
            </div>
            {taxed && (
              <>
                {igst ? (
                  <div className="flex justify-between text-neutral-600">
                    <span>IGST{uniformRate(lines, false)}</span>
                    <span className="tabular-nums">{formatCurrency(t.igst)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-neutral-600">
                      <span>CGST{uniformRate(lines, true)}</span>
                      <span className="tabular-nums">{formatCurrency(t.cgst)}</span>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <span>SGST{uniformRate(lines, true)}</span>
                      <span className="tabular-nums">{formatCurrency(t.sgst)}</span>
                    </div>
                  </>
                )}
                {t.adjustment !== 0 && (
                  <div className="flex justify-between text-neutral-600">
                    <span>Rounding</span>
                    <span className="tabular-nums">{formatCurrency(t.adjustment)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold text-neutral-900">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(invoice.grossAmount)}</span>
            </div>
            {isBajaj && (
              <div className="space-y-1 rounded-lg border border-neutral-200 px-3 py-2 text-neutral-600">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Financed by Bajaj Finance{invoice.doId ? ` · DO ${invoice.doId}` : ""}
                </p>
                {(invoice.downPayment ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Down payment by customer</span>
                    <span className="tabular-nums">{formatCurrency(invoice.downPayment ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Financed by Bajaj Finance</span>
                  <span className="tabular-nums">{formatCurrency(financed)}</span>
                </div>
              </div>
            )}
            {creditNotes.map((cn) => (
              <div key={cn.number} className="flex justify-between text-neutral-600">
                <span>
                  Credit note {cn.number} <span className="text-neutral-500">· {formatDate(cn.noteDate)}</span>
                </span>
                <span className="tabular-nums text-red-600">(-) {formatCurrency(cn.grossAmount)}</span>
              </div>
            ))}
            {netReceived > 0 && !cancelled && (
              <div className="flex justify-between text-neutral-600">
                <span>Payment received{bal.refunded > 0 ? " (net of refunds)" : ""}</span>
                <span className="tabular-nums text-emerald-700">(-) {formatCurrency(netReceived)}</span>
              </div>
            )}
            {bal.tds > 0 && !cancelled && (
              <p className="text-right text-xs text-neutral-500">Includes {formatCurrency(bal.tds)} TDS deducted by the customer</p>
            )}
            {!cancelled && (
              <div
                className={`flex justify-between rounded-lg px-3 py-2 text-base font-bold ${
                  bal.settled && bal.toRefund <= 0.5 ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-900"
                }`}
              >
                <span>
                  {bal.toRefund > 0.5 ? "To refund" : bajajPending && bal.balance > 0.5 ? "Balance due (Bajaj Finance)" : "Balance due"}
                </span>
                <span className="tabular-nums">{formatCurrency(bal.toRefund > 0.5 ? bal.toRefund : bal.balance)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mx-8 mt-4 rounded-lg bg-neutral-50 px-4 py-3 text-sm italic text-neutral-600">
          Total in words: <span className="font-semibold not-italic text-neutral-900">{amountInWords(invoice.grossAmount)}</span>
        </div>

        {taxed && (
          <div className="overflow-x-auto px-8 pt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">HSN/SAC summary</p>
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-y border-neutral-200 bg-neutral-50 text-left uppercase tracking-wide text-neutral-500">
                  <th className="py-2 pr-3 font-semibold">HSN/SAC</th>
                  <th className="py-2 pr-3 text-right font-semibold">Taxable value</th>
                  <th className="py-2 pr-3 text-right font-semibold">Rate</th>
                  {igst ? (
                    <th className="py-2 pr-3 text-right font-semibold">IGST</th>
                  ) : (
                    <>
                      <th className="py-2 pr-3 text-right font-semibold">CGST</th>
                      <th className="py-2 pr-3 text-right font-semibold">SGST</th>
                    </>
                  )}
                  <th className="py-2 text-right font-semibold">Total tax</th>
                </tr>
              </thead>
              <tbody>
                {t.hsnSummary.map((h) => (
                  <tr key={`${h.hsnSac}-${h.gstPercent}`} className="border-b border-neutral-100 text-neutral-700">
                    <td className="py-2 pr-3">{h.hsnSac}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(h.taxable)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{h.gstPercent}%</td>
                    {igst ? (
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(h.igst)}</td>
                    ) : (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(h.cgst)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(h.sgst)}</td>
                      </>
                    )}
                    <td className="py-2 text-right tabular-nums">{formatCurrency(Math.round((h.cgst + h.sgst + h.igst) * 100) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

        <p className="border-t border-neutral-100 px-8 py-3 text-center text-[11px] text-neutral-500">
          This is a computer-generated {brand.documentTitle.toLowerCase()} and is valid without a physical stamp.
        </p>
      </div>
    </div>
  );
}
