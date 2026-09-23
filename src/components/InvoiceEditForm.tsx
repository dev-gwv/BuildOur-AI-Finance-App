"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import {
  isInterStateSupply,
  placeOfSupplyFromGstin,
  stateCodeFromGstin,
  stateCodeFromPlaceOfSupply,
  stateNameFromCode,
} from "@/lib/gstState";
import { formatCurrency, formatDate } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { FieldError, focusFirstError, hintClass, inputClass, labelClass, useFieldErrors, type FieldErrors } from "@/components/invoices/LineFields";
import { LineItemsEditor, lineErrors, lineFromStored, toLineInputs, type CatalogEntry, type EditorLine } from "@/components/invoices/LineItemsEditor";
import { LineBreakupPreview } from "@/components/invoices/LineBreakupPreview";

export type StoredLine = { description: string; hsnSac: string; qty: number; grossAmount: number; gstPercent: number };

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
  /** The invoice's items; one line for invoices raised before line items existed. */
  lines: StoredLine[];
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
  catalog = [],
}: {
  invoice: EditableInvoice;
  detailHref: string;
  /** Money already received; the total can't be edited below it. */
  minGross: number;
  /** Given to admins only: other businesses of the same entity it can move to. */
  businessOptions?: BusinessOption[];
  catalog?: CatalogEntry[];
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const gstRegistered = BRANDS[invoice.brand].gstRegistered;
  const { errors, setErrors, clear, props } = useFieldErrors();
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [customerName, setCustomerName] = useState(invoice.customerName);
  const [customerAddress, setCustomerAddress] = useState(invoice.customerAddress);
  const [customerEmail, setCustomerEmail] = useState(invoice.customerEmail);
  const [customerGstin, setCustomerGstin] = useState(invoice.customerGstin);
  const [placeOfSupply, setPlaceOfSupply] = useState(invoice.placeOfSupply);
  const [lines, setLines] = useState<EditorLine[]>(() => invoice.lines.map(lineFromStored));
  const [notes, setNotes] = useState(invoice.notes);
  const [terms, setTerms] = useState(invoice.terms);
  const [businessId, setBusinessId] = useState(invoice.businessId);
  const isBajaj = invoice.saleType === "BAJAJ";
  const [doId, setDoId] = useState(invoice.doId ?? "");
  const [downPayment, setDownPayment] = useState(String(invoice.downPayment ?? 0));

  const lineInputs = toLineInputs(lines, gstRegistered);
  const total = Math.round(lineInputs.reduce((s, l) => s + l.grossAmount, 0) * 100) / 100;
  const down = Math.max(0, Number(downPayment) || 0);
  const financed = Math.max(0, Math.round((total - down) * 100) / 100);

  // The GSTIN's state when there is one, else the place of supply's.
  const buyerStateCode = stateCodeFromGstin(customerGstin) ?? stateCodeFromPlaceOfSupply(placeOfSupply);
  const buyerStateName = stateNameFromCode(buyerStateCode);
  const interState = isInterStateSupply(customerGstin, placeOfSupply);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!invoiceNumber.trim()) e.invoiceNumber = "The invoice needs a number";
    if (!customerName.trim()) e.customerName = "Who is this invoice for?";
    if (gstRegistered && !customerAddress.trim()) e.customerAddress = "A tax invoice must show the customer's address";
    if (gstRegistered && !placeOfSupply.trim()) e.placeOfSupply = "Place of supply is required";
    if (isBajaj && !doId.trim()) e.doId = "The DO number is required for a Bajaj sale";
    if (isBajaj && total > 0 && down >= total) e.downPayment = "Must be less than the invoice total";
    const le = lineErrors(lines, gstRegistered);
    if (total > 0 && total < minGross - 0.005 && lines.length) {
      le[`lines.${lines.length - 1}.grossAmount`] = `${formatCurrency(minGross)} is already received — the total can't go below it`;
    }
    return { ...e, ...le };
  }
  const live = validate();
  const shown: FieldErrors = attempted ? { ...errors, ...live } : errors;

  function applyGstin(gstin: string) {
    const clean = gstin.trim().toUpperCase();
    setCustomerGstin(clean);
    clear("customerGstin");
    const pos = placeOfSupplyFromGstin(clean);
    if (pos) setPlaceOfSupply(pos);
    else if (!clean) setPlaceOfSupply(BRANDS.GRATEFUL.placeOfSupply ?? "Delhi (07)");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAttempted(true);
    const problems = validate();
    if (Object.keys(problems).length) {
      setErrors(problems);
      focusFirstError(formRef.current, problems);
      return;
    }
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
          lines: lineInputs,
          notes,
          terms,
          ...(businessId !== invoice.businessId ? { businessId } : {}),
          ...(isBajaj ? { doId, downPayment: down } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.fields && Object.keys(err.fields).length) {
          setErrors(err.fields);
          focusFirstError(formRef.current, err.fields);
        }
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

  const field = (n: string) => ({ ...props(n), "aria-invalid": shown[n] ? true : undefined });

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid min-w-0 gap-6">
        {invoice.emailSentAt && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This invoice was emailed on {formatDate(invoice.emailSentAt)}. Saving marks it as revised — re-send it so the customer has the
              current version.
            </p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle title="Invoice" subtitle="Number and dates" />
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="ed-invoiceNumber">
                Invoice number
              </label>
              <input
                id="ed-invoiceNumber"
                value={invoiceNumber}
                onChange={(e) => {
                  setInvoiceNumber(e.target.value);
                  clear("invoiceNumber");
                }}
                className={inputClass}
                {...field("invoiceNumber")}
              />
              <FieldError id="err-invoiceNumber" message={shown.invoiceNumber} />
            </div>
            {businessOptions && businessOptions.length > 1 && (
              <div>
                <label className={labelClass} htmlFor="ed-businessId">
                  Business
                </label>
                <select id="ed-businessId" value={businessId} onChange={(e) => setBusinessId(e.target.value)} className={inputClass}>
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
              <label className={labelClass} htmlFor="ed-invoiceDate">
                Invoice date
              </label>
              <input
                id="ed-invoiceDate"
                type="date"
                value={invoiceDate}
                onChange={(e) => {
                  setInvoiceDate(e.target.value);
                  clear("invoiceDate");
                }}
                className={inputClass}
                {...field("invoiceDate")}
              />
              <FieldError id="err-invoiceDate" message={shown.invoiceDate} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ed-dueDate">
                Due date
              </label>
              <input
                id="ed-dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  clear("dueDate");
                }}
                className={inputClass}
                {...field("dueDate")}
              />
              <FieldError id="err-dueDate" message={shown.dueDate} />
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
                <label className={labelClass} htmlFor="ed-customerName">
                  Name
                </label>
                <input
                  id="ed-customerName"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    clear("customerName");
                  }}
                  className={inputClass}
                  {...field("customerName")}
                />
                <FieldError id="err-customerName" message={shown.customerName} />
              </div>
              <div>
                <label className={labelClass} htmlFor="ed-customerEmail">
                  Email <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <input
                  id="ed-customerEmail"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => {
                    setCustomerEmail(e.target.value);
                    clear("customerEmail");
                  }}
                  placeholder="name@example.com"
                  className={inputClass}
                  {...field("customerEmail")}
                />
                <FieldError id="err-customerEmail" message={shown.customerEmail} />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="ed-customerAddress">
                Address{!gstRegistered && <span className="font-normal text-neutral-500"> (optional)</span>}
              </label>
              <textarea
                id="ed-customerAddress"
                value={customerAddress}
                onChange={(e) => {
                  setCustomerAddress(e.target.value);
                  clear("customerAddress");
                }}
                rows={2}
                className={inputClass}
                {...field("customerAddress")}
              />
              <FieldError id="err-customerAddress" message={shown.customerAddress} />
            </div>
            {gstRegistered && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="ed-customerGstin">
                    GSTIN <span className="font-normal text-neutral-500">(optional)</span>
                  </label>
                  <input
                    id="ed-customerGstin"
                    value={customerGstin}
                    onChange={(e) => applyGstin(e.target.value)}
                    placeholder="Leave blank for a B2C sale"
                    className={`${inputClass} tabular-nums`}
                    {...field("customerGstin")}
                  />
                  <FieldError id="err-customerGstin" message={shown.customerGstin} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="ed-placeOfSupply">
                    Place of supply
                  </label>
                  <input
                    id="ed-placeOfSupply"
                    value={placeOfSupply}
                    onChange={(e) => {
                      setPlaceOfSupply(e.target.value);
                      clear("placeOfSupply");
                    }}
                    className={inputClass}
                    {...field("placeOfSupply")}
                  />
                  <FieldError id="err-placeOfSupply" message={shown.placeOfSupply} />
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle
              title="Items"
              subtitle={gstRegistered ? "Amounts include GST; each line can have its own rate" : "No GST — not GST-registered"}
            />
          </CardHeader>
          <CardBody className="grid gap-4">
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              catalog={gstRegistered ? catalog : []}
              gstRegistered={gstRegistered}
              errors={shown}
              onFieldEdit={clear}
              fieldProps={field}
            />
            {isBajaj && (
              <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4 sm:grid-cols-3 dark:border-brand-500/20 dark:bg-brand-500/[0.06]">
                <div>
                  <label className={labelClass} htmlFor="ed-doId">
                    Bajaj DO number
                  </label>
                  <input
                    id="ed-doId"
                    value={doId}
                    onChange={(e) => {
                      setDoId(e.target.value.toUpperCase());
                      clear("doId");
                    }}
                    className={`${inputClass} font-mono`}
                    {...field("doId")}
                  />
                  <FieldError id="err-doId" message={shown.doId} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="ed-downPayment">
                    Down payment (₹)
                  </label>
                  <input
                    id="ed-downPayment"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={downPayment}
                    onChange={(e) => {
                      setDownPayment(e.target.value);
                      clear("downPayment");
                    }}
                    disabled={invoice.bajajDisbursed}
                    className={`${inputClass} tabular-nums disabled:opacity-60`}
                    {...field("downPayment")}
                  />
                  <FieldError id="err-downPayment" message={shown.downPayment} />
                </div>
                <div>
                  <p className={labelClass}>Bajaj finances</p>
                  <p className="mt-2 font-semibold tabular-nums text-neutral-900 dark:text-white">{formatCurrency(financed)}</p>
                  {invoice.bajajDisbursed && <p className={hintClass}>Locked — Bajaj has paid out.</p>}
                </div>
              </div>
            )}
            {minGross > 0 && <p className={hintClass}>{formatCurrency(minGross)} has already been received — the total can&apos;t go below that.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle title="Notes & terms" />
          </CardHeader>
          <CardBody className="grid gap-4">
            <div>
              <label className={labelClass} htmlFor="ed-notes">
                Notes
              </label>
              <input id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ed-terms">
                Terms &amp; conditions
              </label>
              <textarea id="ed-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputClass} />
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" loading={pending}>
            Save changes
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push(detailHref)}>
            Cancel
          </Button>
          <span className="text-xs text-neutral-600 dark:text-neutral-400">Payment rows in the Google Sheet are updated to match.</span>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <LineBreakupPreview
          lines={lineInputs}
          gstRegistered={gstRegistered}
          interState={interState}
          stateLabel={
            buyerStateCode
              ? `${buyerStateName ?? "Unknown state"} (${buyerStateCode}) · ${interState ? "Inter-state · IGST" : "Intra-state · CGST + SGST"}`
              : "No GSTIN or state · Intra-state · CGST + SGST"
          }
        />
      </div>
    </form>
  );
}
