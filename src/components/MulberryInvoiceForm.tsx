"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileCheck2, SlidersHorizontal, UploadCloud } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { parseQuotationText } from "@/lib/parseQuotation";
import { extractPdfTextInBrowser, uploadDirectToBlob } from "@/lib/clientUpload";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-xs text-sm outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 dark:border-white/10 dark:bg-neutral-950/60";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export function MulberryInvoiceForm({
  suggestedNumber,
  defaultTerms,
  defaultNotes,
}: {
  suggestedNumber: string;
  defaultTerms: string;
  defaultNotes: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState(false);
  const [readIt, setReadIt] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState(suggestedNumber);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [grossAmount, setGrossAmount] = useState("");
  const [advancePaid, setAdvancePaid] = useState("");
  const [notes, setNotes] = useState(defaultNotes);
  const [terms, setTerms] = useState(defaultTerms);

  const total = Number(grossAmount) || 0;
  const advance = Number(advancePaid) || 0;
  const balance = Math.max(Math.round((total - advance) * 100) / 100, 0);
  const ready = Boolean(customerName && itemDescription && total > 0);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setParsing(true);
    try {
      // Parsed here in the browser rather than server-side: these decks are
      // tens of megabytes, far past what a serverless function may receive.
      const text = await extractPdfTextInBrowser(picked);
      const parsed = parseQuotationText(text, picked.name);
      setReadIt(true);
      if (parsed.clientName) setCustomerName(parsed.clientName);
      if (parsed.totalAmount) setGrossAmount(String(parsed.totalAmount));
      if (parsed.events?.length) {
        setItemDescription(`Wedding Package — ${parsed.events.join(", ")}`);
      }
      toast.success(
        parsed.totalAmount
          ? "Quotation read — check the details and generate the invoice"
          : "Quotation read, but no total found — please enter the amount"
      );
    } catch {
      toast.error("Couldn't read that PDF — please fill in the details manually");
    } finally {
      setParsing(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const body = new FormData();
      body.append("brand", "MULBERRY");
      body.append("invoiceNumber", invoiceNumber);
      body.append("invoiceDate", invoiceDate);
      body.append("dueDate", dueDate);
      body.append("customerName", customerName);
      body.append("customerEmail", customerEmail);
      body.append("customerAddress", customerAddress);
      body.append("placeOfSupply", "");
      body.append("itemDescription", itemDescription);
      body.append("hsnSac", "");
      body.append("qty", qty);
      body.append("grossAmount", grossAmount);
      body.append("gstPercent", "0");
      body.append("advancePaid", String(advance));
      body.append("notes", notes);
      body.append("terms", terms);

      // Sent straight to storage from here for the same size reason; the
      // invoice only needs the resulting file name.
      if (file) {
        try {
          body.append("doFilePath", await uploadDirectToBlob(file));
        } catch {
          toast.info("Invoice saved, but the quotation file couldn't be attached");
        }
      }

      const res = await fetch("/api/invoices", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Something went wrong");
        return;
      }
      const { invoice } = await res.json();
      toast.success("Invoice generated");
      router.push(`/mulberry/${invoice.id}`);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-6">
        <Card>
          <CardBody>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                file
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : "border-neutral-200 hover:border-rose-400 hover:bg-rose-50/40 dark:border-white/10 dark:hover:bg-rose-950/20"
              }`}
            >
              {file ? (
                <FileCheck2 className="h-7 w-7 text-emerald-500" />
              ) : (
                <UploadCloud className="h-7 w-7 text-neutral-400" />
              )}
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {file ? file.name : "Upload the wedding package quotation (PDF)"}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {parsing
                  ? "Reading the quotation…"
                  : file
                    ? "Click to choose a different file"
                    : "Client name, events and total fill in automatically"}
              </span>
              <input type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
            </label>
          </CardBody>
        </Card>

        {(readIt || customerName || grossAmount) && (
          <Card className={ready ? "border-emerald-200 dark:border-emerald-900" : "border-amber-200 dark:border-amber-900"}>
            <CardHeader>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {ready ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                {ready ? "Ready to generate" : "Fill in what's missing"}
              </h2>
            </CardHeader>
            <CardBody className="grid gap-4">
              <div>
                <label className={labelClass}>Bill to</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Client name"
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Client email</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  The invoice can be emailed straight to the client once it&apos;s generated.
                </p>
              </div>

              <div>
                <label className={labelClass}>Item / description</label>
                <textarea
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  rows={3}
                  placeholder="e.g. Wedding Function (Photography Plus Cinematography Plus Album)"
                  required
                  className={inputClass}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Total amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={grossAmount}
                    onChange={(e) => setGrossAmount(e.target.value)}
                    required
                    className={`${inputClass} font-semibold tabular-nums`}
                  />
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    From the quotation. Change it for a discount.
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Advance received (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={total || undefined}
                    value={advancePaid}
                    onChange={(e) => setAdvancePaid(e.target.value)}
                    placeholder="0"
                    className={`${inputClass} tabular-nums`}
                  />
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    Leave blank if nothing has been paid yet.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        <details className="group rounded-2xl border border-neutral-200/80 bg-white shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-semibold text-neutral-700 marker:content-none dark:text-neutral-300">
            <SlidersHorizontal className="h-4 w-4 text-neutral-400" />
            Edit all details
            <span className="ml-auto text-xs font-normal text-neutral-400 group-open:hidden">
              invoice no., dates, address, notes…
            </span>
          </summary>
          <div className="grid gap-4 border-t border-neutral-100 px-5 py-4 dark:border-white/[0.06]">
            <div className="grid gap-4 sm:grid-cols-2">
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
                <label className={labelClass}>Quantity</label>
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
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
              <label className={labelClass}>Client address (optional)</label>
              <textarea
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                rows={2}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Terms &amp; conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={inputClass} />
            </div>
          </div>
        </details>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={pending} disabled={!ready}>
            Generate invoice
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/mulberry")}>
            Cancel
          </Button>
          {!ready && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Upload a quotation, or fill in the client and amount
            </span>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Card className="border-rose-100 dark:border-rose-950">
          <CardHeader>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Summary</h3>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <dt>Total</dt>
              <dd className="text-right tabular-nums">{formatCurrency(total)}</dd>
              <dt>Advance received</dt>
              <dd className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                {advance > 0 ? `− ${formatCurrency(advance)}` : "—"}
              </dd>
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                Balance due
              </dt>
              <dd className="border-t border-neutral-100 pt-2 text-right font-semibold tabular-nums text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">
                {formatCurrency(balance)}
              </dd>
            </dl>
            <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
              No GST is charged — The Mulberry Weddings is not GST-registered.
            </p>
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
