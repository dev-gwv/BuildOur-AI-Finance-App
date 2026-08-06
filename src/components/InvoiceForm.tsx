"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileCheck2, Receipt, SlidersHorizontal, UploadCloud } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export type CatalogEntry = { id: string; amount: number; itemDescription: string; hsnSac: string };

export function InvoiceForm({
  suggestedNumber,
  catalog,
  defaultTerms,
  defaultNotes,
}: {
  suggestedNumber: string;
  catalog: CatalogEntry[];
  defaultTerms: string;
  defaultNotes: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [doFile, setDoFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState(false);
  const [doId, setDoId] = useState("");
  const [doDate, setDoDate] = useState("");
  const [itemMatched, setItemMatched] = useState(false);
  const [customerGstin, setCustomerGstin] = useState("");
  const [docType, setDocType] = useState<"DO" | "GST" | null>(null);
  /** Set when the product's catalog price was used because the source had no amount. */
  const [amountFromCatalog, setAmountFromCatalog] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState(suggestedNumber);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(BRANDS.GRATEFUL.placeOfSupply ?? "Delhi (07)");
  const [itemDescription, setItemDescription] = useState("");
  const [hsnSac, setHsnSac] = useState("999259");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [grossAmount, setGrossAmount] = useState("");
  const [gstPercent, setGstPercent] = useState("18");
  const [notes, setNotes] = useState(defaultNotes);
  const [terms, setTerms] = useState(defaultTerms);

  const breakup = calculateInvoiceBreakup({
    grossAmount: Number(grossAmount) || 0,
    gstPercent: Number(gstPercent) || 0,
    qty: Number(qty) || 1,
  });

  // A DO has been read (or details were entered by hand) — worth showing the summary.
  const parsed = Boolean(customerName || grossAmount);
  // Everything the invoice legally needs is present.
  const ready = Boolean(customerName && customerAddress && itemDescription && Number(grossAmount) > 0);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDoFile(file);
    setParsing(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/invoices/parse", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't read that PDF — fill in the details manually");
        return;
      }
      const { parsed } = await res.json();
      setDocType(parsed.docType);

      if (parsed.docType === "GST") {
        // A GST certificate carries who the customer is, but never an amount —
        // that comes from the product picked below (and stays editable).
        const name = parsed.tradeName || parsed.legalName;
        if (name) setCustomerName(name);
        if (parsed.address) setCustomerAddress(parsed.address);
        if (parsed.gstin) setCustomerGstin(parsed.gstin);
        setAmountFromCatalog(false);
        toast.success(
          parsed.gstin
            ? "GST certificate read — now pick the product to set the amount"
            : "Read the certificate, but couldn't find a GSTIN — please check the details below"
        );
        return;
      }

      if (parsed.customerName) setCustomerName(parsed.customerName);
      if (parsed.deliveryAddress) setCustomerAddress(parsed.deliveryAddress);
      if (parsed.doDate) {
        setInvoiceDate(parsed.doDate);
        setDueDate(parsed.doDate);
        setDoDate(parsed.doDate);
      }
      if (parsed.doId) setDoId(parsed.doId);

      if (parsed.productPrice) {
        setGrossAmount(String(parsed.productPrice));
        setAmountFromCatalog(false);
        const match = catalog.find((c) => c.amount === parsed.productPrice);
        if (match) {
          setSelectedItemId(match.id);
          setItemDescription(match.itemDescription);
          setHsnSac(match.hsnSac);
          setItemMatched(true);
          toast.success("DO read and item matched from your catalog — ready to generate");
        } else {
          setItemMatched(false);
          toast.success("DO read — now pick the product from the dropdown below");
        }
      } else {
        toast.success("Extracted the DO — review the details below and add the item");
      }
    } catch {
      toast.error("Network error while reading the PDF");
    } finally {
      setParsing(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const body = new FormData();
      body.append("invoiceNumber", invoiceNumber);
      body.append("invoiceDate", invoiceDate);
      body.append("dueDate", dueDate);
      body.append("customerName", customerName);
      body.append("customerAddress", customerAddress);
      body.append("customerEmail", customerEmail);
      body.append("customerGstin", customerGstin);
      body.append("placeOfSupply", placeOfSupply);
      body.append("itemDescription", itemDescription);
      body.append("hsnSac", hsnSac);
      body.append("qty", qty);
      body.append("grossAmount", grossAmount);
      body.append("gstPercent", gstPercent);
      body.append("notes", notes);
      body.append("terms", terms);
      body.append("doId", doId);
      body.append("doDate", doDate);
      if (doFile) body.append("doFile", doFile);

      const res = await fetch("/api/invoices", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Something went wrong");
        return;
      }
      const { invoice } = await res.json();
      toast.success("Invoice generated");
      router.push(`/invoices/${invoice.id}`);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-6">
        {/* Step 1 — the only action needed in the common case */}
        <Card>
          <CardBody>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                doFile
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : "border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-neutral-700 dark:hover:bg-indigo-950/20"
              }`}
            >
              {doFile ? (
                <FileCheck2 className="h-7 w-7 text-emerald-500" />
              ) : (
                <UploadCloud className="h-7 w-7 text-neutral-400" />
              )}
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {doFile ? doFile.name : "Upload the delivery order or GST certificate (PDF)"}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {parsing
                  ? "Reading the document…"
                  : doFile
                    ? docType === "GST"
                      ? "Read as a GST certificate · click to choose a different file"
                      : docType === "DO"
                        ? "Read as a Bajaj delivery order · click to choose a different file"
                        : "Click to choose a different file"
                    : "Bajaj DO or the customer's GST certificate — details fill in automatically"}
              </span>
              <input type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
            </label>
          </CardBody>
        </Card>

        {/* Step 2 — what was read, at a glance */}
        {parsed && (
          <Card className={ready ? "border-emerald-200 dark:border-emerald-900" : "border-amber-200 dark:border-amber-900"}>
            <CardHeader className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {ready ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                {ready ? "Ready to generate" : "Almost there — pick the product"}
              </h2>
              {doId && (
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  DO {doId}
                  {doDate && ` · ${doDate}`}
                </span>
              )}
            </CardHeader>
            <CardBody className="grid gap-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-neutral-500 dark:text-neutral-400">Bill to</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100">{customerName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500 dark:text-neutral-400">Customer GSTIN</dt>
                  <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {customerGstin || "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-neutral-500 dark:text-neutral-400">Address</dt>
                  <dd className="text-neutral-600 dark:text-neutral-400">{customerAddress || "—"}</dd>
                </div>
              </dl>

              {catalog.length > 0 && (
                <div>
                  <label className={labelClass}>
                    Product
                    {itemMatched && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        matched automatically
                      </span>
                    )}
                  </label>
                  <select
                    value={selectedItemId}
                    onChange={(e) => {
                      const entry = catalog.find((c) => c.id === e.target.value);
                      setSelectedItemId(e.target.value);
                      if (entry) {
                        setItemDescription(entry.itemDescription);
                        setHsnSac(entry.hsnSac);
                        // A GST certificate has no amount of its own, so take the
                        // product's list price as the starting point. A DO's own
                        // amount is authoritative and must not be overwritten.
                        if (docType !== "DO") {
                          setGrossAmount(String(entry.amount));
                          setAmountFromCatalog(true);
                        }
                      }
                      setItemMatched(false);
                    }}
                    className={inputClass}
                  >
                    <option value="">Select a product…</option>
                    {catalog.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.itemDescription} — {formatCurrency(entry.amount)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={labelClass}>Customer email</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  The invoice can be emailed straight to the customer once it&apos;s generated.
                </p>
              </div>

              {/* Kept here rather than behind "Edit all details": part-payments and
                  discounts mean this genuinely gets changed on the way through. */}
              <div>
                <label className={labelClass}>Amount to bill (GST-inclusive, ₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={grossAmount}
                  onChange={(e) => {
                    setGrossAmount(e.target.value);
                    setAmountFromCatalog(false);
                    setItemMatched(false);
                  }}
                  required
                  className={`${inputClass} font-semibold tabular-nums`}
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {docType === "DO"
                    ? "Taken from the DO. Change it for a discount or a part payment."
                    : amountFromCatalog
                      ? "The product's list price. Change it for a discount or a part payment."
                      : "Change it freely for a discount or a part payment."}
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Everything else stays out of the way until it's actually needed */}
        <details className="group rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-semibold text-neutral-700 marker:content-none dark:text-neutral-300">
            <SlidersHorizontal className="h-4 w-4 text-neutral-400" />
            Edit all details
            <span className="ml-auto text-xs font-normal text-neutral-400 group-open:hidden">
              invoice no., dates, GST, notes…
            </span>
          </summary>

          <div className="grid gap-4 border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Invoice number</label>
                <input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Place of supply</label>
                <input
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Invoice date</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Bill to (customer name)</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Customer address</label>
              <textarea
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                rows={2}
                required
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Customer GSTIN (optional)</label>
              <input
                value={customerGstin}
                onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                placeholder="Filled in automatically from a GST certificate"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Item / description</label>
              <input
                value={itemDescription}
                onChange={(e) => {
                  setItemDescription(e.target.value);
                  setItemMatched(false);
                  setSelectedItemId("");
                }}
                placeholder="e.g. Diamond Premium 2.0"
                required
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>HSN/SAC</label>
                <input value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Qty</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
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
            </div>

            <div>
              <label className={labelClass}>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Terms &amp; conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={inputClass} />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Prefilled from Invoice Settings — change here only for this one invoice.
              </p>
            </div>
          </div>
        </details>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={pending} disabled={!ready}>
            Generate invoice
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/invoices")}>
            Cancel
          </Button>
          {!ready && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Upload a DO and pick the product to continue
            </span>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Card className="border-indigo-100 dark:border-indigo-950">
          <CardHeader className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Breakup preview</h3>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <dt>Sub total</dt>
              <dd className="text-right tabular-nums">{formatCurrency(breakup.subTotal)}</dd>
              <dt>CGST ({breakup.cgstPercent}%)</dt>
              <dd className="text-right tabular-nums">{formatCurrency(breakup.cgstAmount)}</dd>
              <dt>SGST ({breakup.sgstPercent}%)</dt>
              <dd className="text-right tabular-nums">{formatCurrency(breakup.sgstAmount)}</dd>
              {breakup.adjustment !== 0 && (
                <>
                  <dt>Adjustment</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(breakup.adjustment)}</dd>
                </>
              )}
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-neutral-800 dark:text-neutral-100">
                Total
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-emerald-600 dark:border-neutral-800 dark:text-emerald-400">
                {formatCurrency(breakup.total)}
              </dd>
            </dl>
            {breakup.total > 0 && (
              <p className="mt-3 text-xs italic text-neutral-500 dark:text-neutral-400">
                {amountInWords(breakup.total)}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
