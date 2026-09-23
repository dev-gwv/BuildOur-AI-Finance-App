"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, CheckCircle2, FileCheck2, Landmark, ListOrdered, SlidersHorizontal, UploadCloud, UserRound } from "lucide-react";
import { todayISO } from "@/lib/dates";
import {
  guessStateCodeFromAddress,
  isInterStateSupply,
  placeOfSupplyFromCode,
  placeOfSupplyFromGstin,
  stateCodeFromGstin,
  stateCodeFromPlaceOfSupply,
  stateNameFromCode,
} from "@/lib/gstState";
import { formatCurrency, formatDate } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { readImageText } from "@/lib/clientUpload";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { checkRowClass, FieldError, Rupee, focusFirstError, hintClass, inputClass, labelClass, moneyInputClass, textareaClass, type FieldErrors, useFieldErrors } from "@/components/invoices/LineFields";
import {
  LineItemsEditor,
  lineErrors,
  newLine,
  toLineInputs,
  type CatalogEntry,
  type EditorLine,
} from "@/components/invoices/LineItemsEditor";
import { LineBreakupPreview } from "@/components/invoices/LineBreakupPreview";

export type { CatalogEntry };

/** BAJAJ = financed by Bajaj Finance, raised from its delivery order; DIRECT = the customer pays us. */
export type SaleType = "BAJAJ" | "DIRECT";

const DEFAULT_POS = BRANDS.GRATEFUL.placeOfSupply ?? "Delhi (07)";

/** Human names for what's still missing, in the order the form reads. */
const NEEDS: Array<[string, string]> = [
  ["customerName", "customer name"],
  ["customerAddress", "customer address"],
  ["doId", "DO number"],
  ["downPayment", "a valid down payment"],
  ["lines", "item details"],
  ["placeOfSupply", "place of supply"],
];

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
  const formRef = useRef<HTMLFormElement>(null);
  const today = todayISO();
  const { errors, setErrors, clear, props } = useFieldErrors();
  const [attempted, setAttempted] = useState(false);

  const [doFile, setDoFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [pending, setPending] = useState(false);
  const [doId, setDoId] = useState("");
  const [doDate, setDoDate] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [docType, setDocType] = useState<"DO" | "GST" | null>(null);

  // Blank means "take the next number in the series" — reserved by the server on save.
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(DEFAULT_POS);
  const [lines, setLines] = useState<EditorLine[]>(() => [newLine({ hsnSac: "999259", gstPercent: "18" })]);
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

  const lineInputs = toLineInputs(lines);
  const price = Math.round(lineInputs.reduce((s, l) => s + l.grossAmount, 0) * 100) / 100;
  const down = Math.max(0, Number(downPayment) || 0);
  const financed = Math.max(0, Math.round((price - down) * 100) / 100);
  // Price - down payment must equal the loan the DO states; if not, a figure was misread.
  const doDisagrees = isBajaj && loanFromDo != null && price > 0 && Math.abs(price - down - loanFromDo) > 1;

  // The GSTIN's state when there is one, else the place of supply's.
  const buyerStateCode = stateCodeFromGstin(customerGstin) ?? stateCodeFromPlaceOfSupply(placeOfSupply);
  const buyerStateName = stateNameFromCode(buyerStateCode);
  const interState = isInterStateSupply(customerGstin, placeOfSupply);

  /** Everything the invoice needs, keyed like the API's `fields`. */
  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!customerName.trim()) e.customerName = "Who is this invoice for?";
    if (!customerAddress.trim()) e.customerAddress = "A tax invoice must show the customer's address";
    if (!placeOfSupply.trim()) e.placeOfSupply = "Place of supply is required";
    if (isBajaj && !doId.trim()) e.doId = "The DO number is required for a Bajaj sale";
    if (isBajaj && price > 0 && down >= price) e.downPayment = "Must be less than the invoice total — Bajaj finances the rest";
    return { ...e, ...lineErrors(lines, true) };
  }
  const live = validate();
  const ready = Object.keys(live).length === 0;
  const missing = NEEDS.filter(([key]) => (key === "lines" ? Object.keys(live).some((k) => k.startsWith("lines.")) : key in live)).map(
    ([, label]) => label
  );
  // Errors show once the user has tried to submit (or the server said so), then update as they type.
  const shown: FieldErrors = attempted ? { ...errors, ...live } : errors;

  function applyGstin(gstin: string) {
    const clean = gstin.trim().toUpperCase();
    setCustomerGstin(clean);
    clear("customerGstin");
    const pos = placeOfSupplyFromGstin(clean);
    if (pos) setPlaceOfSupply(pos);
    // Clearing the GSTIN makes it B2C again: the place of supply comes from the address.
    else if (!clean) setPlaceOfSupply(placeOfSupplyFromCode(guessStateCodeFromAddress(customerAddress)) ?? DEFAULT_POS);
  }

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
        toast.error(err.error ?? "Couldn't read that file — fill in the details below by hand");
        return;
      }
      const { parsed, ocr } = await res.json();
      setDocType(parsed.docType);
      if (ocr) toast.info("Read from an image with OCR — double-check the name, date and amount");
      setMismatch(parsed.docType === "DO" && !isBajaj ? "DO_ON_DIRECT" : parsed.docType === "GST" && isBajaj ? "GST_ON_BAJAJ" : null);

      if (parsed.docType === "GST") {
        // A GST certificate carries who the customer is, but never an amount —
        // that comes from the items below.
        const name = parsed.tradeName || parsed.legalName;
        if (name) setCustomerName(name);
        if (parsed.address) setCustomerAddress(parsed.address);
        // The GSTIN's state code also decides place of supply and CGST+SGST vs IGST.
        if (parsed.gstin) applyGstin(parsed.gstin);
        setErrors({});
        toast.success(
          parsed.gstin
            ? "GST certificate read — now add the items"
            : "Read the certificate, but couldn't find a GSTIN — please check the customer details"
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
        // A DO finances one product: it becomes the first line (any others stay).
        const match = catalog.find((c) => c.amount === parsed.productPrice);
        setLines((prev) => [
          newLine({
            description: match?.itemDescription ?? prev[0]?.description ?? "",
            hsnSac: match?.hsnSac ?? (prev[0]?.hsnSac || "999259"),
            gstPercent: prev[0]?.gstPercent ?? "18",
            grossAmount: String(parsed.productPrice),
            fromDo: true,
            catalogId: match?.id,
          }),
          ...prev.slice(1),
        ]);
        toast.success(match ? "DO read and product matched from your catalog — check and generate" : "DO read — now pick the product for the item");
      } else {
        toast.success("Extracted the DO — review the details and add the item");
      }
      setErrors({});
    } catch {
      toast.error("Couldn't read that file — fill in the details below by hand");
    } finally {
      setParsing(false);
      setOcrRunning(false);
    }
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
      body.append("lines", JSON.stringify(lineInputs));
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
        if (err.fields && Object.keys(err.fields).length) {
          setErrors(err.fields);
          focusFirstError(formRef.current, err.fields);
        }
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

  const stateLabel = buyerStateCode
    ? `${buyerStateName ?? "Unknown state"} (${buyerStateCode}) · ${interState ? "Inter-state · IGST" : "Intra-state · CGST + SGST"}`
    : "No GSTIN or state · Intra-state · CGST + SGST";

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid min-w-0 gap-6">
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
              className={`flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors sm:gap-3 ${
                saleType === opt.key
                  ? "bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              }`}
            >
              <opt.icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{opt.label}</span>
                <span className={`mt-0.5 hidden text-xs sm:block ${saleType === opt.key ? "opacity-70" : "text-neutral-500"}`}>{opt.hint}</span>
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
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-within:ring-4 focus-within:ring-brand-500/15 ${
                doFile
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : "border-neutral-200 hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/10 dark:hover:bg-brand-950/20"
              }`}
            >
              {doFile ? <FileCheck2 className="h-7 w-7 text-emerald-500" /> : <UploadCloud className="h-7 w-7 text-neutral-400" />}
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {doFile ? doFile.name : isBajaj ? "Upload or photograph Bajaj's delivery order" : "Upload or photograph the customer's GST certificate"}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {parsing
                  ? ocrRunning
                    ? "Reading the image with OCR — this takes a few seconds…"
                    : "Reading the document…"
                  : doFile
                    ? docType === "GST"
                      ? "Read as a GST certificate · tap to choose a different file"
                      : docType === "DO"
                        ? "Read as a Bajaj delivery order · tap to choose a different file"
                        : "Tap to choose a different file"
                    : isBajaj
                      ? "PDF, photo or screenshot — the customer, DO number, price and down payment fill in automatically"
                      : "PDF, photo or screenshot — or skip it and fill in the customer below for a walk-in sale"}
              </span>
              {/* capture opens the camera on phones; desktops still get the file picker. */}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={onFileChange}
                aria-label={isBajaj ? "Delivery order file" : "GST certificate file"}
              />
            </label>
          </CardBody>
        </Card>

        {/* Step 2 — who it's for. Always visible: every required field lives here or in Items. */}
        <Card>
          <CardHeader>
            <CardTitle
              title={
                <span className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-neutral-400" />
                  Customer
                </span>
              }
              subtitle={docType ? "Filled in from the document — check it" : "Who the invoice is billed to"}
              action={
                isBajaj && doId ? (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    DO {doId}
                    {doDate && ` · ${formatDate(doDate)}`}
                  </span>
                ) : undefined
              }
            />
          </CardHeader>
          <CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="inv-customerName">
                  Name
                </label>
                <input
                  id="inv-customerName"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    clear("customerName");
                  }}
                  autoComplete="off"
                  className={inputClass}
                  {...props("customerName")}
                  aria-invalid={shown.customerName ? true : undefined}
                />
                <FieldError id="err-customerName" message={shown.customerName} />
              </div>
              <div>
                <label className={labelClass} htmlFor="inv-customerEmail">
                  Email <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <input
                  id="inv-customerEmail"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => {
                    setCustomerEmail(e.target.value);
                    clear("customerEmail");
                  }}
                  placeholder="name@example.com"
                  className={inputClass}
                  {...props("customerEmail")}
                />
                <FieldError id="err-customerEmail" message={shown.customerEmail} />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="inv-customerAddress">
                Address
              </label>
              <textarea
                id="inv-customerAddress"
                value={customerAddress}
                onChange={(e) => {
                  setCustomerAddress(e.target.value);
                  clear("customerAddress");
                }}
                rows={2}
                className={textareaClass}
                {...props("customerAddress")}
                aria-invalid={shown.customerAddress ? true : undefined}
              />
              <FieldError id="err-customerAddress" message={shown.customerAddress} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="inv-customerGstin">
                  GSTIN <span className="font-normal text-neutral-500">(optional — B2B)</span>
                </label>
                <input
                  id="inv-customerGstin"
                  value={customerGstin}
                  onChange={(e) => applyGstin(e.target.value)}
                  placeholder="From a GST certificate, or blank for B2C"
                  className={`${inputClass} tabular-nums`}
                  {...props("customerGstin")}
                />
                <FieldError id="err-customerGstin" message={shown.customerGstin} />
              </div>
              <div>
                <label className={labelClass} htmlFor="inv-placeOfSupply">
                  Place of supply
                </label>
                <input
                  id="inv-placeOfSupply"
                  value={placeOfSupply}
                  onChange={(e) => {
                    setPlaceOfSupply(e.target.value);
                    clear("placeOfSupply");
                  }}
                  className={inputClass}
                  {...props("placeOfSupply")}
                  aria-invalid={shown.placeOfSupply ? true : undefined}
                />
                <FieldError id="err-placeOfSupply" message={shown.placeOfSupply} />
                {!shown.placeOfSupply && <p className={hintClass}>Decides CGST + SGST or IGST when there&apos;s no GSTIN.</p>}
              </div>
            </div>

            {isBajaj && (
              <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4 dark:border-brand-500/20 dark:bg-brand-500/[0.06]">
                <p className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                  <Landmark className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                  Financed by Bajaj Finance
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="inv-doId">
                      DO number
                    </label>
                    <input
                      id="inv-doId"
                      value={doId}
                      onChange={(e) => {
                        setDoId(e.target.value.toUpperCase());
                        clear("doId");
                      }}
                      placeholder="e.g. B429427477"
                      className={`${inputClass} font-mono placeholder:font-sans`}
                      {...props("doId")}
                      aria-invalid={shown.doId ? true : undefined}
                    />
                    <FieldError id="err-doId" message={shown.doId} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="inv-downPayment">
                      Down payment
                    </label>
                    <Rupee>
                      <input
                        id="inv-downPayment"
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={downPayment}
                        onChange={(e) => {
                          setDownPayment(e.target.value);
                          clear("downPayment");
                        }}
                        className={`${moneyInputClass}`}
                        {...props("downPayment")}
                        aria-invalid={shown.downPayment ? true : undefined}
                      />
                    </Rupee>
                    <FieldError id="err-downPayment" message={shown.downPayment} />
                  </div>
                </div>
                {doDisagrees && loanFromDo != null && (
                  <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    <span>
                      The DO says Bajaj finances {formatCurrency(loanFromDo)}, but total − down payment is {formatCurrency(financed)}. One of the
                      figures was probably misread — check them against the DO.
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
                  <span className="text-neutral-600 dark:text-neutral-400">Bajaj finances</span>
                  <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">{formatCurrency(financed)}</span>
                </div>
                {loanTerms && (
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
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
                  <label className={checkRowClass}>
                    <input
                      type="checkbox"
                      checked={downPaymentReceived}
                      onChange={(e) => setDownPaymentReceived(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">The customer has paid the {formatCurrency(down)} down payment</span>
                      <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-400">
                        Recorded as received. Bajaj&apos;s payout is recorded on the invoice when it reaches the bank.
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    Nothing is marked paid yet — record Bajaj&apos;s payout on the invoice when it reaches the bank.
                  </p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Step 3 — what's being billed */}
        <Card>
          <CardHeader>
            <CardTitle
              title={
                <span className="flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-neutral-400" />
                  Items
                </span>
              }
              subtitle={
                docType === "DO"
                  ? "The product price from the DO — the invoice is for the full price, whoever pays it"
                  : "Amounts include GST; each line can have its own rate"
              }
            />
          </CardHeader>
          <CardBody>
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              catalog={catalog}
              gstRegistered
              errors={shown}
              onFieldEdit={clear}
              fieldProps={(n) => ({ ...props(n), "aria-invalid": shown[n] ? true : undefined })}
            />
          </CardBody>
        </Card>

        {/* The rest has sensible defaults and stays out of the way */}
        <details className="group rounded-2xl border border-neutral-200/80 bg-white shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-semibold text-neutral-700 marker:content-none dark:text-neutral-300">
            <SlidersHorizontal className="h-4 w-4 text-neutral-400" />
            Number, dates, notes &amp; terms
            <span className="ml-auto text-xs font-normal text-neutral-500 group-open:hidden">
              {invoiceNumber || `Auto · ${suggestedNumber}`} · {formatDate(invoiceDate)}
            </span>
          </summary>

          <div className="grid gap-4 border-t border-neutral-100 px-5 py-4 dark:border-white/[0.06]">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="inv-invoiceNumber">
                  Invoice number
                </label>
                <input
                  id="inv-invoiceNumber"
                  value={invoiceNumber}
                  onChange={(e) => {
                    setInvoiceNumber(e.target.value);
                    clear("invoiceNumber");
                  }}
                  placeholder={`Auto · ${suggestedNumber}`}
                  className={inputClass}
                  {...props("invoiceNumber")}
                />
                <FieldError id="err-invoiceNumber" message={shown.invoiceNumber} />
                {!shown.invoiceNumber && <p className={hintClass}>Blank takes the next number in the series.</p>}
              </div>
              <div>
                <label className={labelClass} htmlFor="inv-invoiceDate">
                  Invoice date
                </label>
                <input
                  id="inv-invoiceDate"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => {
                    setInvoiceDate(e.target.value);
                    clear("invoiceDate");
                  }}
                  className={inputClass}
                  {...props("invoiceDate")}
                />
                <FieldError id="err-invoiceDate" message={shown.invoiceDate} />
              </div>
              <div>
                <label className={labelClass} htmlFor="inv-dueDate">
                  Due date
                </label>
                <input
                  id="inv-dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    clear("dueDate");
                  }}
                  className={inputClass}
                  {...props("dueDate")}
                />
                <FieldError id="err-dueDate" message={shown.dueDate} />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="inv-notes">
                Notes
              </label>
              <input id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className={labelClass} htmlFor="inv-terms">
                Terms &amp; conditions
              </label>
              <textarea id="inv-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={textareaClass} />
              <p className={hintClass}>Prefilled from Invoice defaults — change here only for this one invoice.</p>
            </div>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" loading={pending}>
            Generate invoice
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/invoices")}>
            Cancel
          </Button>
          <p className="flex items-center gap-1.5 text-xs" aria-live="polite">
            {ready ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-neutral-600 dark:text-neutral-400">Ready — {formatCurrency(price)}</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-neutral-600 dark:text-neutral-400">Still needed: {missing.join(", ")}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <LineBreakupPreview
          lines={lineInputs}
          gstRegistered
          interState={interState}
          stateLabel={stateLabel}
          footer={
            isBajaj && price > 0 ? (
              <dl className="mt-4 grid grid-cols-2 gap-y-1.5 border-t border-neutral-100 pt-3 text-sm dark:border-white/[0.06]">
                <dt className="text-neutral-600 dark:text-neutral-400">Customer pays</dt>
                <dd className="text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(down)}</dd>
                <dt className="text-neutral-600 dark:text-neutral-400">Bajaj finances</dt>
                <dd className="text-right font-medium tabular-nums text-brand-700 dark:text-brand-300">{formatCurrency(financed)}</dd>
              </dl>
            ) : undefined
          }
        />
      </div>
    </form>
  );
}
