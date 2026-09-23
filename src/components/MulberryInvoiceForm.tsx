"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileCheck2, ListOrdered, SlidersHorizontal, UploadCloud, UserRound } from "lucide-react";
import { todayISO } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { parseQuotationText } from "@/lib/parseQuotation";
import { extractPdfTextInBrowser, readImageText, uploadDirectToBlob } from "@/lib/clientUpload";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { FieldError, Rupee, focusFirstError, hintClass, inputClass, labelClass, moneyInputClass, textareaClass, type FieldErrors, useFieldErrors } from "@/components/invoices/LineFields";
import { LineItemsEditor, lineErrors, newLine, toLineInputs, type EditorLine } from "@/components/invoices/LineItemsEditor";

export function MulberryInvoiceForm({
  suggestedNumber,
  defaultTerms,
  defaultNotes,
  businessId,
}: {
  /** The business the invoice is raised for; its series and sheet apply. */
  businessId: string;
  suggestedNumber: string;
  defaultTerms: string;
  defaultNotes: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const today = todayISO();
  const { errors, setErrors, clear, props } = useFieldErrors();
  const [attempted, setAttempted] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState(false);
  const [readIt, setReadIt] = useState(false);

  // Blank means "take the next number in the series" — reserved by the server on save.
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [lines, setLines] = useState<EditorLine[]>(() => [newLine({ gstPercent: "0" })]);
  const [advancePaid, setAdvancePaid] = useState("");
  const [notes, setNotes] = useState(defaultNotes);
  const [terms, setTerms] = useState(defaultTerms);

  const lineInputs = toLineInputs(lines, false);
  const total = Math.round(lineInputs.reduce((s, l) => s + l.grossAmount, 0) * 100) / 100;
  const advance = Number(advancePaid) || 0;
  const balance = Math.max(Math.round((total - advance) * 100) / 100, 0);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!customerName.trim()) e.customerName = "Who is this invoice for?";
    if (advance < 0) e.advancePaid = "Can't be negative";
    else if (total > 0 && advance > total) e.advancePaid = `At most the total, ${formatCurrency(total)}`;
    return { ...e, ...lineErrors(lines, false) };
  }
  const live = validate();
  const ready = Object.keys(live).length === 0;
  const shown: FieldErrors = attempted ? { ...errors, ...live } : errors;
  const missing = [
    live.customerName && "client name",
    Object.keys(live).some((k) => k.startsWith("lines.")) && "package details and amount",
    live.advancePaid && "a valid advance",
  ].filter(Boolean);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setParsing(true);
    try {
      // Parsed here in the browser rather than server-side: these decks are
      // tens of megabytes, far past what a serverless function may receive.
      // A photo of a quotation is read with OCR the same way.
      const text = picked.type.startsWith("image/") ? await readImageText(picked) : await extractPdfTextInBrowser(picked);
      const parsed = parseQuotationText(text, picked.name);
      setReadIt(true);
      if (parsed.clientName) setCustomerName(parsed.clientName);
      if (parsed.totalAmount || parsed.events?.length) {
        setLines((prev) => [
          newLine({
            gstPercent: "0",
            description: parsed.events?.length ? `Wedding Package — ${parsed.events.join(", ")}` : prev[0]?.description ?? "Wedding Package",
            grossAmount: parsed.totalAmount ? String(parsed.totalAmount) : prev[0]?.grossAmount ?? "",
          }),
          ...prev.slice(1),
        ]);
      }
      setErrors({});
      toast.success(
        parsed.totalAmount ? "Quotation read — check the details and generate the invoice" : "Quotation read, but no total found — please enter the amount"
      );
    } catch {
      toast.error("Couldn't read that file — please fill in the details by hand");
    } finally {
      setParsing(false);
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
      body.append("source", "QUOTATION");
      if (invoiceNumber.trim()) body.append("invoiceNumber", invoiceNumber.trim());
      body.append("invoiceDate", invoiceDate);
      body.append("dueDate", dueDate);
      body.append("customerName", customerName);
      body.append("customerEmail", customerEmail);
      body.append("customerAddress", customerAddress);
      body.append("placeOfSupply", "");
      body.append("lines", JSON.stringify(lineInputs));
      body.append("advancePaid", String(advance));
      body.append("notes", notes);
      body.append("terms", terms);

      // Sent straight to storage from here for the same size reason; the
      // invoice only needs the resulting file name.
      let attachFailed = false;
      if (file) {
        try {
          body.append("doFilePath", await uploadDirectToBlob(file));
        } catch {
          attachFailed = true;
        }
      }

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
      if (attachFailed || warning) toast.info(warning ?? "The invoice was saved, but the quotation file couldn't be attached.");
      router.push(`/invoices/${invoice.id}`);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid min-w-0 gap-6">
        <Card>
          <CardBody>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-within:ring-4 focus-within:ring-brand-500/15 ${
                file
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : "border-neutral-200 hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/10 dark:hover:bg-brand-950/20"
              }`}
            >
              {file ? <FileCheck2 className="h-7 w-7 text-emerald-500" /> : <UploadCloud className="h-7 w-7 text-neutral-400" />}
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {file ? file.name : "Upload or photograph the wedding package quotation"}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {parsing ? "Reading the quotation…" : file ? "Tap to choose a different file" : "PDF or photo — client name, events and total fill in automatically"}
              </span>
              {/* capture opens the camera on phones; desktops still get the file picker. */}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={onFileChange}
                aria-label="Quotation file"
              />
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle
              title={
                <span className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-neutral-400" />
                  Client
                </span>
              }
              subtitle={readIt ? "Filled in from the quotation — check it" : "Who the invoice is for"}
            />
          </CardHeader>
          <CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="mb-customerName">
                  Bill to
                </label>
                <input
                  id="mb-customerName"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    clear("customerName");
                  }}
                  placeholder="e.g. Aman & Ruchika"
                  className={inputClass}
                  {...props("customerName")}
                  aria-invalid={shown.customerName ? true : undefined}
                />
                <FieldError id="err-customerName" message={shown.customerName} />
              </div>
              <div>
                <label className={labelClass} htmlFor="mb-customerEmail">
                  Client email <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <input
                  id="mb-customerEmail"
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
              <label className={labelClass} htmlFor="mb-customerAddress">
                Client address <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <textarea
                id="mb-customerAddress"
                value={customerAddress}
                onChange={(e) => {
                  setCustomerAddress(e.target.value);
                  clear("customerAddress");
                }}
                rows={2}
                className={textareaClass}
                {...props("customerAddress")}
              />
              <FieldError id="err-customerAddress" message={shown.customerAddress} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle
              title={
                <span className="flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-neutral-400" />
                  Package
                </span>
              }
              subtitle="No GST — The Mulberry Weddings isn't GST-registered"
            />
          </CardHeader>
          <CardBody className="grid gap-4">
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              gstRegistered={false}
              errors={shown}
              onFieldEdit={clear}
              fieldProps={(n) => ({ ...props(n), "aria-invalid": shown[n] ? true : undefined })}
            />
            <div className="sm:w-1/2">
              <label className={labelClass} htmlFor="mb-advancePaid">
                Advance received
              </label>
              <Rupee>
                <input
                  id="mb-advancePaid"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={advancePaid}
                  onChange={(e) => {
                    setAdvancePaid(e.target.value);
                    clear("advancePaid");
                  }}
                  placeholder="0"
                  className={`${moneyInputClass}`}
                  {...props("advancePaid")}
                  aria-invalid={shown.advancePaid ? true : undefined}
                />
              </Rupee>
              <FieldError id="err-advancePaid" message={shown.advancePaid} />
              {!shown.advancePaid && <p className={hintClass}>Leave blank if nothing has been paid yet.</p>}
            </div>
          </CardBody>
        </Card>

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
                <label className={labelClass} htmlFor="mb-invoiceNumber">
                  Invoice number
                </label>
                <input
                  id="mb-invoiceNumber"
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
                <label className={labelClass} htmlFor="mb-invoiceDate">
                  Invoice date
                </label>
                <input
                  id="mb-invoiceDate"
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
                <label className={labelClass} htmlFor="mb-dueDate">
                  Due date
                </label>
                <input
                  id="mb-dueDate"
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
              <label className={labelClass} htmlFor="mb-notes">
                Notes
              </label>
              <input id="mb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="mb-terms">
                Terms &amp; conditions
              </label>
              <textarea id="mb-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={textareaClass} />
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
                <span className="text-neutral-600 dark:text-neutral-400">Ready — {formatCurrency(total)}</span>
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
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Summary</h3>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <dt>Total</dt>
              <dd className="text-right tabular-nums">{formatCurrency(total)}</dd>
              <dt>Advance received</dt>
              <dd className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{advance > 0 ? `− ${formatCurrency(advance)}` : "—"}</dd>
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                Balance due
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right font-semibold tabular-nums text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                {formatCurrency(balance)}
              </dd>
            </dl>
            <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">No GST is charged — The Mulberry Weddings is not GST-registered.</p>
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
