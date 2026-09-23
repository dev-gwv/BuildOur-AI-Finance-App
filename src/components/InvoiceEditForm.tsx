"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Receipt } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import {
  isInterStateSupply,
  placeOfSupplyFromGstin,
  stateCodeFromGstin,
  stateCodeFromPlaceOfSupply,
  stateNameFromCode,
} from "@/lib/gstState";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency, formatDate } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export type EditableInvoice = {
  id: string;
  brand: "GRATEFUL" | "MULBERRY";
  invoiceNumber: string;
  /** yyyy-mm-dd */
  invoiceDate: string;
  dueDate: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  customerGstin: string;
  placeOfSupply: string;
  itemDescription: string;
  hsnSac: string;
  qty: number;
  grossAmount: number;
  gstPercent: number;
  notes: string;
  terms: string;
  emailSentAt: string | null;
  businessId: string;
  /** Bajaj Finance sales: the DO and the customer's down payment (Bajaj finances the rest). */
  saleType?: string;
  doId?: string;
  downPayment?: number;
  /** Bajaj has already paid out — the financed amount can't move any more. */
  bajajDisbursed?: boolean;
};

/** A business an admin can move this invoice to (same legal entity only). */
export type BusinessOption = { id: string; name: string; color: string };

export function InvoiceEditForm({
  invoice,
  detailHref,
  minGross,
  businessOptions,
}: {
  invoice: EditableInvoice;
  detailHref: string;
  /** Money already received; the amount can't be edited below it. */
  minGross: number;
  /** Given to admins only: other businesses of the same entity it can move to. */
  businessOptions?: BusinessOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const gstRegistered = BRANDS[invoice.brand].gstRegistered;
  const [pending, setPending] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [customerName, setCustomerName] = useState(invoice.customerName);
  const [customerAddress, setCustomerAddress] = useState(invoice.customerAddress);
  const [customerEmail, setCustomerEmail] = useState(invoice.customerEmail);
  const [customerGstin, setCustomerGstin] = useState(invoice.customerGstin);
  const [placeOfSupply, setPlaceOfSupply] = useState(invoice.placeOfSupply);
  const [itemDescription, setItemDescription] = useState(invoice.itemDescription);
  const [hsnSac, setHsnSac] = useState(invoice.hsnSac);
  const [qty, setQty] = useState(String(invoice.qty));
  const [grossAmount, setGrossAmount] = useState(String(invoice.grossAmount));
  const [gstPercent, setGstPercent] = useState(String(invoice.gstPercent));
  const [notes, setNotes] = useState(invoice.notes);
  const [terms, setTerms] = useState(invoice.terms);
  const [businessId, setBusinessId] = useState(invoice.businessId);
  const isBajaj = invoice.saleType === "BAJAJ";
  const [doId, setDoId] = useState(invoice.doId ?? "");
  const [downPayment, setDownPayment] = useState(String(invoice.downPayment ?? 0));
  const down = Math.max(0, Number(downPayment) || 0);
  const financed = Math.max(0, Math.round(((Number(grossAmount) || 0) - down) * 100) / 100);
  const downInvalid = isBajaj && down >= (Number(grossAmount) || 0);

  // The GSTIN's state when there is one, else the place of supply's.
  const buyerStateCode = stateCodeFromGstin(customerGstin) ?? stateCodeFromPlaceOfSupply(placeOfSupply);
  const buyerStateName = stateNameFromCode(buyerStateCode);
  const interState = isInterStateSupply(customerGstin, placeOfSupply);
  const breakup = calculateInvoiceBreakup({
    grossAmount: Number(grossAmount) || 0,
    gstPercent: gstRegistered ? Number(gstPercent) || 0 : 0,
    qty: Number(qty) || 1,
    isInterState: gstRegistered && interState,
  });
  const belowPaid = (Number(grossAmount) || 0) < minGross - 0.005;

  function applyGstin(gstin: string) {
    const clean = gstin.trim().toUpperCase();
    setCustomerGstin(clean);
    const pos = placeOfSupplyFromGstin(clean);
    if (pos) setPlaceOfSupply(pos);
    else if (!clean) setPlaceOfSupply(BRANDS.GRATEFUL.placeOfSupply ?? "Delhi (07)");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceNumber,
          invoiceDate,
          dueDate,
          customerName,
          customerAddress,
          customerEmail,
          customerGstin,
          placeOfSupply,
          itemDescription,
          hsnSac,
          qty: Number(qty),
          grossAmount: Number(grossAmount),
          gstPercent: Number(gstPercent),
          notes,
          terms,
          ...(businessId !== invoice.businessId ? { businessId } : {}),
          ...(isBajaj ? { doId, downPayment: down } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't save the invoice");
        return;
      }
      toast.success(invoice.emailSentAt ? "Invoice updated — marked as revised" : "Invoice updated");
      router.push(detailHref);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-6">
        {invoice.emailSentAt && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This invoice was emailed on {formatDate(invoice.emailSentAt)}. Saving marks it as revised — re-send it
              so the customer has the current version.
            </p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle title="Invoice" subtitle="Number and dates" />
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Invoice number</label>
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required className={inputClass} />
            </div>
            {businessOptions && businessOptions.length > 1 && (
              <div>
                <label className={labelClass}>Business</label>
                <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className={inputClass}>
                  {businessOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {businessId !== invoice.businessId && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Moves the invoice and its payments to that business&apos;s reports and sheet. The number stays as it is.
                  </p>
                )}
              </div>
            )}
            <div>
              <label className={labelClass}>Invoice date</label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className={inputClass} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle title="Customer" subtitle="Who the invoice is billed to" />
          </CardHeader>
          <CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Name</label>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Address</label>
              <textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} rows={2} required className={inputClass} />
            </div>
            {gstRegistered && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>GSTIN (optional)</label>
                  <input
                    value={customerGstin}
                    onChange={(e) => applyGstin(e.target.value)}
                    placeholder="Leave blank for a B2C sale"
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Place of supply</label>
                  <input value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} required className={inputClass} />
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle title="Item & amount" />
          </CardHeader>
          <CardBody className="grid gap-4">
            <div>
              <label className={labelClass}>Item / description</label>
              <input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} required className={inputClass} />
            </div>
            <div className={`grid gap-4 ${gstRegistered ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              <div className={gstRegistered ? "sm:col-span-2" : ""}>
                <label className={labelClass}>Amount ({gstRegistered ? "GST-inclusive, " : ""}₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                  required
                  className={`${inputClass} font-semibold tabular-nums`}
                />
              </div>
              <div>
                <label className={labelClass}>Qty</label>
                <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} required className={inputClass} />
              </div>
              {gstRegistered ? (
                <div>
                  <label className={labelClass}>GST %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={gstPercent}
                    onChange={(e) => setGstPercent(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
              ) : (
                <div>
                  <label className={labelClass}>HSN/SAC</label>
                  <input value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} className={inputClass} />
                </div>
              )}
            </div>
            {isBajaj && (
              <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4 sm:grid-cols-3 dark:border-brand-500/20 dark:bg-brand-500/[0.06]">
                <div>
                  <label className={labelClass}>Bajaj DO number</label>
                  <input
                    value={doId}
                    onChange={(e) => setDoId(e.target.value.toUpperCase())}
                    required
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Down payment (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    disabled={invoice.bajajDisbursed}
                    aria-invalid={downInvalid}
                    className={`${inputClass} tabular-nums disabled:opacity-60`}
                  />
                  {downInvalid && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Must be less than the amount.</p>}
                </div>
                <div>
                  <p className={labelClass}>Bajaj finances</p>
                  <p className="mt-2 font-semibold tabular-nums text-neutral-900 dark:text-white">{formatCurrency(financed)}</p>
                  {invoice.bajajDisbursed && (
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Locked — Bajaj has paid out.</p>
                  )}
                </div>
              </div>
            )}
            {gstRegistered && (
              <div className="sm:w-1/2">
                <label className={labelClass}>HSN/SAC</label>
                <input value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} required className={inputClass} />
              </div>
            )}
            {minGross > 0 && (
              <p className={`text-xs ${belowPaid ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                {formatCurrency(minGross)} has already been received — the amount can&apos;t go below that.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle title="Notes & terms" />
          </CardHeader>
          <CardBody className="grid gap-4">
            <div>
              <label className={labelClass}>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Terms &amp; conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputClass} />
            </div>
          </CardBody>
        </Card>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={pending} disabled={belowPaid || downInvalid || (isBajaj && !doId.trim())}>
            Save changes
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push(detailHref)}>
            Cancel
          </Button>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Payment rows in the Google Sheet are updated to match.
          </span>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {gstRegistered ? "Breakup preview" : "Total"}
            </h3>
          </CardHeader>
          <CardBody>
            {gstRegistered && (
              <p
                className={`mb-3 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  interState
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {buyerStateCode
                  ? `${buyerStateName ?? "Unknown state"} (${buyerStateCode}) · ${
                      interState ? "Inter-state · IGST" : "Intra-state · CGST + SGST"
                    }`
                  : "No GSTIN · Intra-state · CGST + SGST"}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              {gstRegistered && (
                <>
                  <dt>Sub total</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(breakup.subTotal)}</dd>
                  {breakup.taxMode === "IGST" ? (
                    <>
                      <dt>IGST ({breakup.igstPercent}%)</dt>
                      <dd className="text-right tabular-nums">{formatCurrency(breakup.igstAmount)}</dd>
                    </>
                  ) : (
                    <>
                      <dt>CGST ({breakup.cgstPercent}%)</dt>
                      <dd className="text-right tabular-nums">{formatCurrency(breakup.cgstAmount)}</dd>
                      <dt>SGST ({breakup.sgstPercent}%)</dt>
                      <dd className="text-right tabular-nums">{formatCurrency(breakup.sgstAmount)}</dd>
                    </>
                  )}
                  {breakup.adjustment !== 0 && (
                    <>
                      <dt>Adjustment</dt>
                      <dd className="text-right tabular-nums">{formatCurrency(breakup.adjustment)}</dd>
                    </>
                  )}
                </>
              )}
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                Total
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right font-semibold tabular-nums text-emerald-600 dark:border-white/[0.06] dark:text-emerald-400">
                {formatCurrency(breakup.total)}
              </dd>
            </dl>
            {breakup.total > 0 && (
              <p className="mt-3 text-xs italic text-neutral-500 dark:text-neutral-400">{amountInWords(breakup.total)}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
