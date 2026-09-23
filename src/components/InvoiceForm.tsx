"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileCheck2, Receipt, SlidersHorizontal, UploadCloud } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import { isInterStateSupply, placeOfSupplyFromGstin, stateCodeFromGstin, stateNameFromCode } from "@/lib/gstState";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { readImageText } from "@/lib/clientUpload";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export type CatalogEntry = { id: string; amount: number; itemDescription: string; hsnSac: string };

export function InvoiceForm({
  suggestedNumber,
  catalog,
  defaultTerms,
  defaultNotes,
  businessId,
}: {
  suggestedNumber: string;
  catalog: CatalogEntry[];
  defaultTerms: string;
  defaultNotes: string;
  /** The business the invoice is raised for; its series and sheet apply. */
  businessId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [doFile, setDoFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [pending, setPending] = useState(false);
  const [doId, setDoId] = useState("");
  const [doDate, setDoDate] = useState("");
  const [itemMatched, setItemMatched] = useState(false);
  const [customerGstin, setCustomerGstin] = useState("");
  const [docType, setDocType] = useState<"DO" | "GST" | null>(null);
  /** Set when the product's catalog price was used because the source had no amount. */
  const [amountFromCatalog, setAmountFromCatalog] = useState(false);

  // Blank means "take the next number in the series" — reserved by the server on save.
  const [invoiceNumber, setInvoiceNumber] = useState("");
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

  // GSTIN first 2 digits -> buyer state. 07 Delhi = CGST+SGST, else IGST.
  const buyerStateCode = stateCodeFromGstin(customerGstin);
  const buyerStateName = stateNameFromCode(buyerStateCode);
  const interState = isInterStateSupply(customerGstin);

  const breakup = calculateInvoiceBreakup({
    grossAmount: Number(grossAmount) || 0,
    gstPercent: Number(gstPercent) || 0,
    qty: Number(qty) || 1,
    isInterState: interState,
  });

  function applyGstin(gstin: string) {
    const clean = gstin.trim().toUpperCase();
    setCustomerGstin(clean);
    const pos = placeOfSupplyFromGstin(clean);
    if (pos) setPlaceOfSupply(pos);
    // Clearing the GSTIN makes it B2C again, which is billed as intra-state.
    else if (!clean) setPlaceOfSupply(BRANDS.GRATEFUL.placeOfSupply ?? "Delhi (07)");
  }

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
      if (file.type.startsWith("image/")) {
        // A photo or screenshot has no text layer: read it here with OCR and
        // send only the text, so the parsing rules are the same as for a PDF.
        setOcrRunning(true);
        body.append("text", await readImageText(file));
      } else {
        body.append("file", file);
      }
      const res = await fetch("/api/invoices/parse", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't read that PDF — fill in the details manually");
        return;
      }
      const { parsed, ocr } = await res.json();
      setDocType(parsed.docType);
      if (ocr) toast.info("Read from an image with OCR — double-check the name, date and amount");

      if (parsed.docType === "GST") {
        // A GST certificate carries who the customer is, but never an amount —
        // that comes from the product picked below (and stays editable).
        const name = parsed.tradeName || parsed.legalName;
        if (name) setCustomerName(name);
        if (parsed.address) setCustomerAddress(parsed.address);
        // The GSTIN's state code also decides place of supply and CGST+SGST vs IGST.
        if (parsed.gstin) applyGstin(parsed.gstin);
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
      toast.error("Couldn't read that file — fill in the details below by hand");
    } finally {
      setParsing(false);
      setOcrRunning(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const body = new FormData();
      body.append("businessId", businessId);
      if (invoiceNumber.trim()) body.append("invoiceNumber", invoiceNumber.trim());
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
      // Tells the server whether this was a Bajaj-financed sale (paid in full on disbursement).
      if (docType) body.append("source", docType);
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
                  : "border-neutral-200 hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/10 dark:hover:bg-brand-950/20"
              }`}
            >
              {doFile ? (
                <FileCheck2 className="h-7 w-7 text-emerald-500" />
              ) : (
                <UploadCloud className="h-7 w-7 text-neutral-400" />
              )}
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {doFile ? doFile.name : "Upload the delivery order or GST certificate"}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {parsing
                  ? ocrRunning
                    ? "Reading the image with OCR — this takes a few seconds…"
                    : "Reading the document…"
                  : doFile
                    ? docType === "GST"
                      ? "Read as a GST certificate · click to choose a different file"
                      : docType === "DO"
                        ? "Read as a Bajaj delivery order · click to choose a different file"
                        : "Click to choose a different file"
                    : "Bajaj DO or GST certificate — PDF, photo or screenshot. Details fill in automatically"}
              </span>
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={onFileChange} />
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
        <details className="group rounded-2xl border border-neutral-200/80 bg-white shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-semibold text-neutral-700 marker:content-none dark:text-neutral-300">
            <SlidersHorizontal className="h-4 w-4 text-neutral-400" />
            Edit all details
            <span className="ml-auto text-xs font-normal text-neutral-400 group-open:hidden">
              invoice no., dates, GST, notes…
            </span>
          </summary>

          <div className="grid gap-4 border-t border-neutral-100 px-5 py-4 dark:border-white/[0.06]">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Invoice number</label>
                <input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder={`Auto · ${suggestedNumber}`}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Leave blank to take the next number in the series.
                </p>
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
                onChange={(e) => applyGstin(e.target.value)}
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
        <Card className="border-brand-100 dark:border-brand-950">
          <CardHeader className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Breakup preview</h3>
          </CardHeader>
          <CardBody>
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
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
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
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                Total
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-emerald-600 dark:border-white/[0.06] dark:text-emerald-400">
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
