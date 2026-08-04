"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Receipt, UploadCloud } from "lucide-react";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency } from "@/lib/format";
import { INVOICE_SELLER } from "@/lib/invoiceSeller";
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

  const [invoiceNumber, setInvoiceNumber] = useState(suggestedNumber);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(INVOICE_SELLER.placeOfSupply);
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
        toast.error("Couldn't read that PDF — fill in the details manually");
        return;
      }
      const { parsed } = await res.json();
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
        <Card>
          <CardHeader className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Bajaj delivery order (DO)
            </h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-sm text-neutral-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-400">
              <UploadCloud className="h-4 w-4" />
              {doFile ? doFile.name : "Upload the Bajaj DO PDF to auto-fill customer & amount"}
              <input type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
            </label>
            {parsing && <p className="text-xs text-indigo-600 dark:text-indigo-400">Reading delivery order…</p>}
            {doId && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <FileCheck2 className="h-3.5 w-3.5" />
                DO {doId} {doDate && `· ${doDate}`}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Invoice details</h2>
          </CardHeader>
          <CardBody className="grid gap-4">
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
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Item</h2>
            {itemMatched && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                Auto-filled from catalog
              </span>
            )}
          </CardHeader>
          <CardBody className="grid gap-4">
            {catalog.length > 0 && (
              <div>
                <label className={labelClass}>Product</label>
                <select
                  value={selectedItemId}
                  onChange={(e) => {
                    const entry = catalog.find((c) => c.id === e.target.value);
                    setSelectedItemId(e.target.value);
                    if (entry) {
                      setItemDescription(entry.itemDescription);
                      setHsnSac(entry.hsnSac);
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
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Picked automatically when the DO amount matches. The invoice always bills the
                  Product Price read from the DO, not the amount shown here.
                </p>
              </div>
            )}

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
              <label className={labelClass}>Amount (GST-inclusive, ₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
                required
                className={inputClass}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Notes (optional)</h2>
          </CardHeader>
          <CardBody className="grid gap-4">
            <div>
              <label className={labelClass}>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Terms & conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={inputClass} />
            </div>
          </CardBody>
        </Card>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={pending}>
            Generate invoice
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/invoices")}>
            Cancel
          </Button>
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
