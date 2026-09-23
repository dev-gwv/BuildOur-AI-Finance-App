"use client";

import { todayISO } from "@/lib/dates";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, CheckCircle2, FileCheck2, Landmark, Receipt, SlidersHorizontal, UploadCloud } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import {
  guessStateCodeFromAddress,
  isInterStateSupply,
  placeOfSupplyFromCode,
  placeOfSupplyFromGstin,
  stateCodeFromGstin,
  stateCodeFromPlaceOfSupply,
  stateNameFromCode,
} from "@/lib/gstState";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency, formatDate } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { readImageText } from "@/lib/clientUpload";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export type CatalogEntry = { id: string; amount: number; itemDescription: string; hsnSac: string };

/** BAJAJ = financed by Bajaj Finance, raised from its delivery order; DIRECT = the customer pays us. */
export type SaleType = "BAJAJ" | "DIRECT";

export function InvoiceForm({
  suggestedNumber,
  catalog,
  defaultTerms,
  defaultNotes,
  businessId,
  saleType: initialSaleType = "DIRECT",
}: {
  suggestedNumber: string;
  catalog: CatalogEntry[];
  defaultTerms: string;
  defaultNotes: string;
  /** The business the invoice is raised for; its series and sheet apply. */
  businessId: string;
  /** Chosen on the page before the form; can still be switched here without losing anything typed. */
  saleType?: SaleType;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = todayISO();

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

  const [saleType, setSaleType] = useState<SaleType>(initialSaleType);
  const isBajaj = saleType === "BAJAJ";
  // Bajaj sale: what the customer pays the dealer, and the rest that Bajaj finances.
  const [downPayment, setDownPayment] = useState("0");
  const [downPaymentReceived, setDownPaymentReceived] = useState(false);
  const [loanTerms, setLoanTerms] = useState<{ emi: number | null; tenure: number | null; mobile: string | null } | null>(null);
  /** The loan amount the DO states, to cross-check what was read (OCR can drop or swap a digit). */
  const [loanFromDo, setLoanFromDo] = useState<number | null>(null);
  /** Set when a DO was uploaded for a direct sale (or a GST certificate for a Bajaj one). */
  const [mismatch, setMismatch] = useState<"DO_ON_DIRECT" | "GST_ON_BAJAJ" | null>(null);
  const price = Number(grossAmount) || 0;
  const down = Math.max(0, Number(downPayment) || 0);
  const financed = Math.max(0, Math.round((price - down) * 100) / 100);
  const downPaymentValid = !isBajaj || price === 0 || down < price;
  // Price - down payment must equal the loan the DO states; if not, a figure was misread.
  const doDisagrees = isBajaj && loanFromDo != null && price > 0 && Math.abs(price - down - loanFromDo) > 1;

  // GSTIN first 2 digits -> buyer state. 07 Delhi = CGST+SGST, else IGST.
  // The GSTIN's state when there is one, else the place of supply's.
  const buyerStateCode = stateCodeFromGstin(customerGstin) ?? stateCodeFromPlaceOfSupply(placeOfSupply);
  const buyerStateName = stateNameFromCode(buyerStateCode);
  const interState = isInterStateSupply(customerGstin, placeOfSupply);

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
  // Everything the invoice legally needs is present (and a Bajaj sale its DO number).
  const ready =
    Boolean(customerName && customerAddress && itemDescription && Number(grossAmount) > 0) &&
    (!isBajaj || (Boolean(doId.trim()) && downPaymentValid));

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
      setMismatch(parsed.docType === "DO" && !isBajaj ? "DO_ON_DIRECT" : parsed.docType === "GST" && isBajaj ? "GST_ON_BAJAJ" : null);

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
      if (parsed.deliveryAddress) {
        setCustomerAddress(parsed.deliveryAddress);
        // No GSTIN on a DO: the delivery address decides the place of supply
        // (a Noida customer is inter-state, so IGST). Editable below.
        const pos = placeOfSupplyFromCode(guessStateCodeFromAddress(parsed.deliveryAddress));
        if (pos && !customerGstin) setPlaceOfSupply(pos);
      }
      if (parsed.doDate) {
        setInvoiceDate(parsed.doDate);
        setDueDate(parsed.doDate);
        setDoDate(parsed.doDate);
      }
      if (parsed.doId) setDoId(parsed.doId);
      // The DO's own split, when it states one: the down payment, or the loan
      // amount it leaves (price - loan). Otherwise the customer paid nothing up front.
      const dp =
        parsed.downPayment ??
        (parsed.loanAmount != null && parsed.productPrice ? Math.max(0, parsed.productPrice - parsed.loanAmount) : null);
      setDownPayment(String(dp ?? 0));
      setLoanFromDo(parsed.loanAmount ?? null);
      setLoanTerms(
        parsed.emi || parsed.tenureMonths || parsed.mobile
          ? { emi: parsed.emi ?? null, tenure: parsed.tenureMonths ?? null, mobile: parsed.mobile ?? null }
          : null
      );

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
      if (docType) body.append("source", docType);
      body.append("doDate", doDate);
      // A Bajaj sale isn't marked paid: Bajaj's payout is recorded when it reaches the bank.
      body.append("saleType", saleType);
      if (isBajaj) {
        body.append("downPayment", String(down));
        if (downPaymentReceived && down > 0) body.append("downPaymentReceived", "on");
      }
      if (doFile) body.append("doFile", doFile);

      const res = await fetch("/api/invoices", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Something went wrong");
        return;
      }
      const { invoice, warning } = await res.json();
      toast.success(`Invoice ${invoice.invoiceNumber} generated`);
      if (warning) toast.info(warning);
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
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-neutral-200/80 bg-white p-1.5 shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70">
          {(
            [
              { key: "BAJAJ", label: "Bajaj Finance sale", hint: "Raised from the delivery order", icon: Landmark },
              { key: "DIRECT", label: "Direct sale", hint: "GST certificate or entered by hand", icon: Building2 },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={saleType === opt.key}
              onClick={() => {
                setSaleType(opt.key);
                setMismatch(null);
              }}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                saleType === opt.key
                  ? "bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              }`}
            >
              <opt.icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{opt.label}</span>
                <span className={`block truncate text-xs ${saleType === opt.key ? "opacity-70" : "text-neutral-400"}`}>{opt.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {mismatch && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <span>
              {mismatch === "DO_ON_DIRECT"
                ? "This is a Bajaj delivery order. A Bajaj sale is tracked until Bajaj pays out — switch this invoice to a Bajaj sale?"
                : "This is a GST certificate, not a delivery order. A customer paying you directly is a direct sale."}
            </span>
            <button
              type="button"
              onClick={() => {
                setSaleType(mismatch === "DO_ON_DIRECT" ? "BAJAJ" : "DIRECT");
                setMismatch(null);
              }}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
            >
              {mismatch === "DO_ON_DIRECT" ? "Make it a Bajaj sale" : "Make it a direct sale"}
            </button>
          </div>
        )}

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
                {doFile ? doFile.name : isBajaj ? "Upload Bajaj's delivery order" : "Upload the customer's GST certificate"}
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
                    : isBajaj
                      ? "PDF, photo or screenshot — the customer, DO number, price and down payment fill in automatically"
                      : "PDF, photo or screenshot — or skip it and fill in the details below for a walk-in customer"}
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
              {doId && isBajaj && (
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  DO {doId}
                  {doDate && ` · ${formatDate(doDate)}`}
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

              {isBajaj && (
                <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4 dark:border-brand-500/20 dark:bg-brand-500/[0.06]">
                  <p className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                    <Landmark className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                    Financed by Bajaj Finance
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>DO number</label>
                      <input
                        value={doId}
                        onChange={(e) => setDoId(e.target.value.toUpperCase())}
                        placeholder="e.g. B429427477"
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
                        aria-invalid={!downPaymentValid}
                        className={`${inputClass} tabular-nums ${downPaymentValid ? "" : "border-red-300 focus:border-red-500 focus:ring-red-500/15"}`}
                      />
                      {!downPaymentValid && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">Must be less than the product price.</p>
                      )}
                    </div>
                  </div>
                  {doDisagrees && loanFromDo != null && (
                    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                      <span>
                        The DO says Bajaj finances {formatCurrency(loanFromDo)}, but price − down payment is {formatCurrency(financed)}.
                        One of the figures was probably misread — check them against the DO.
                      </span>
                      {price - loanFromDo >= 0 && (
                        <button
                          type="button"
                          onClick={() => setDownPayment(String(Math.round((price - loanFromDo) * 100) / 100))}
                          className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-500"
                        >
                          Use {formatCurrency(price - loanFromDo)} down payment
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm dark:bg-neutral-950/50">
                    <span className="text-neutral-500 dark:text-neutral-400">Bajaj finances</span>
                    <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">{formatCurrency(financed)}</span>
                  </div>
                  {loanTerms && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      From the DO:{" "}
                      {[
                        loanTerms.emi ? `EMI ${formatCurrency(loanTerms.emi)}` : null,
                        loanTerms.tenure ? `${loanTerms.tenure} months` : null,
                        loanTerms.mobile ? `customer mobile ${loanTerms.mobile}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {down > 0 ? (
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                      <input
                        type="checkbox"
                        checked={downPaymentReceived}
                        onChange={(e) => setDownPaymentReceived(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-brand-600"
                      />
                      <span>
                        The customer has paid the {formatCurrency(down)} down payment
                        <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                          Recorded as received. Bajaj&apos;s payout is recorded on the invoice when it reaches the bank.
                        </span>
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Nothing is marked paid yet — record Bajaj&apos;s payout on the invoice when it reaches the bank.
                    </p>
                  )}
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
                    ? "The product price from the DO — the invoice is for the full price, whoever pays it."
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
              {isBajaj
                ? "Upload the DO (or enter its number) and pick the product to continue"
                : "Add the customer and the product to continue"}
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
            {isBajaj && price > 0 && (
              <dl className="mt-4 grid grid-cols-2 gap-y-1.5 border-t border-neutral-100 pt-3 text-sm dark:border-white/[0.06]">
                <dt className="text-neutral-500 dark:text-neutral-400">Customer pays</dt>
                <dd className="text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(down)}</dd>
                <dt className="text-neutral-500 dark:text-neutral-400">Bajaj finances</dt>
                <dd className="text-right tabular-nums font-medium text-brand-700 dark:text-brand-300">{formatCurrency(financed)}</dd>
              </dl>
            )}
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
