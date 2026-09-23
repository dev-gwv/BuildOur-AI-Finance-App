"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Camera, Loader2, Receipt, ScanText, Upload } from "lucide-react";
import { todayISO } from "@/lib/dates";
import { calculateBreakup, calculateCostBreakup } from "@/lib/calc";
import { formatCurrency } from "@/lib/format";
import { readPaymentScreenshot } from "@/lib/clientUpload";
import { parsePaymentScreenshotText } from "@/lib/parsePaymentScreenshot";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Field, Input, Select, useFieldErrors } from "@/components/ui/Field";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

export type EntryBusiness = {
  id: string;
  name: string;
  color: string;
  defaultGstPercent: number;
  gateways: { id: string; name: string; chargePercent: number }[];
  categories: { id: string; name: string; _count?: { expenses: number } }[];
};

export type ExistingEntry = {
  id: string;
  businessId: string;
  categoryId: string;
  gatewayId: string | null;
  description: string | null;
  date: string;
  grossAmount: number;
  gstPercent: number;
  screenshotPath: string | null;
  direction: string;
};

type FieldName = "description" | "grossAmount" | "date" | "gstPercent" | "categoryName" | "gatewayId" | "businessId";

/** The GST slabs a cost is usually billed at; 0 is "No GST". */
const GST_PRESETS = [0, 5, 12, 18, 28];

/**
 * One money-in or money-out entry. Money out is an expense: it starts with
 * what it was for, typed freely. The category is optional and typeable —
 * pick one of the business's or type a new one and it's created on save.
 * A payment screenshot can fill the amount, date and gateway in (OCR in the
 * browser, like the payments panel), and is kept as the entry's proof.
 * The business comes from the sidebar switcher; the picker only appears when
 * "All businesses" is selected.
 */
export function EntryForm({ businesses, expense }: { businesses: EntryBusiness[]; expense?: ExistingEntry }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!expense;
  const proofInput = useRef<HTMLInputElement>(null);
  const scanInput = useRef<HTMLInputElement>(null);

  const [businessId, setBusinessId] = useState(expense?.businessId ?? businesses[0]?.id ?? "");
  const business = businesses.find((c) => c.id === businessId);
  const [direction, setDirection] = useState<"IN" | "OUT">(expense?.direction === "OUT" ? "OUT" : "IN");
  const isOut = direction === "OUT";

  const [description, setDescription] = useState(expense?.description ?? "");
  const [categoryName, setCategoryName] = useState(() => business?.categories.find((c) => c.id === expense?.categoryId)?.name ?? "");
  const [gatewayId, setGatewayId] = useState<string>(expense?.gatewayId ?? "");
  const [grossAmount, setGrossAmount] = useState<string>(expense ? String(expense.grossAmount) : "");
  const [date, setDate] = useState(expense?.date ?? todayISO());
  const [gstPercent, setGstPercent] = useState<string>(String(expense?.gstPercent ?? business?.defaultGstPercent ?? 18));
  const [pending, setPending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const { errors, apply, clear } = useFieldErrors<FieldName>();

  const gateway = business?.gateways.find((g) => g.id === gatewayId);
  const gatewayChargePercent = isOut ? 0 : (gateway?.chargePercent ?? 0);
  const breakup = calculateBreakup({ grossAmount: Number(grossAmount) || 0, gatewayChargePercent, gstPercent: Number(gstPercent) || 0 });
  const cost = calculateCostBreakup({ grossAmount: Number(grossAmount) || 0, gstPercent: Number(gstPercent) || 0 });

  const trimmedCategory = categoryName.trim();
  const isNewCategory =
    trimmedCategory !== "" && !business?.categories.some((c) => c.name.toLowerCase() === trimmedCategory.toLowerCase());

  function onBusinessChange(id: string) {
    setBusinessId(id);
    setGatewayId("");
    setCategoryName("");
    const next = businesses.find((c) => c.id === id);
    setGstPercent(String(next?.defaultGstPercent ?? 18));
  }

  /** Reads a payment screenshot and fills what it can; everything stays editable. */
  async function scan(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose a screenshot or photo (PNG or JPG) to read");
      return;
    }
    setScanning(true);
    setScanNote(null);
    try {
      const shot = await readPaymentScreenshot(file);
      const found = parsePaymentScreenshotText(shot.text, shot.amountLine);
      const filled: string[] = [];
      if (found.amount) {
        setGrossAmount(String(found.amount));
        clear("grossAmount");
        filled.push("amount");
      }
      if (found.paidOn) {
        setDate(found.paidOn);
        filled.push("date");
      }
      if (!isOut) {
        // A business gateway whose name matches the app or gateway on the screenshot.
        const hint = [found.gateway, found.method].filter(Boolean).map((s) => s!.toLowerCase());
        const match = business?.gateways.find((g) => hint.some((h) => g.name.toLowerCase().includes(h) || h.includes(g.name.toLowerCase())));
        if (match) {
          setGatewayId(match.id);
          filled.push(`gateway (${match.name})`);
        }
      }
      if (!description.trim() && (found.method || found.reference)) {
        setDescription([found.method, found.reference ? `ref ${found.reference}` : null].filter(Boolean).join(" · "));
        filled.push("description");
      }
      // Keep the screenshot as the proof, so it doesn't have to be picked twice.
      if (proofInput.current) {
        const dt = new DataTransfer();
        dt.items.add(file);
        proofInput.current.files = dt.files;
        setProofName(file.name);
      }
      setScanNote(
        filled.length
          ? `Read the ${filled.join(", ")} from the screenshot — check them before saving.`
          : "Couldn't find an amount in that image — enter the details by hand. It's attached as proof."
      );
    } catch {
      toast.error("Couldn't read that image — enter the details by hand");
    } finally {
      setScanning(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const local: Partial<Record<FieldName, string>> = {};
    if (isOut && !description.trim()) local.description = "Say what the expense was for";
    if (!(Number(grossAmount) > 0)) local.grossAmount = "Enter an amount greater than zero";
    if (!date) local.date = "Pick the date";
    const gst = Number(gstPercent);
    if (gstPercent === "" || !(gst >= 0 && gst <= 100)) local.gstPercent = "Between 0 and 100";
    if (Object.keys(local).length) {
      apply(local);
      return;
    }

    setPending(true);
    try {
      const formData = new FormData(e.currentTarget);
      formData.set("businessId", businessId);
      formData.set("categoryName", trimmedCategory);
      const url = isEdit ? `/api/entries/${expense.id}` : "/api/entries";
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        apply(body.fields ?? {});
        toast.error(body.error ?? "Something went wrong");
        return;
      }
      const saved = (await res.json().catch(() => ({}))) as { warning?: string | null };
      if (saved.warning) toast.info(saved.warning);
      else toast.success(isEdit ? "Entry updated" : isOut ? "Expense recorded" : "Money in recorded");
      router.push("/money");
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  if (businesses.length === 0) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        You don&apos;t have access to any business yet. Ask an admin to add you to one.
      </p>
    );
  }

  const amountAndDate = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={isOut ? "Amount paid (incl. GST)" : "Gross amount received"} error={errors.grossAmount}>
        <Input
          id="entry-amount"
          name="grossAmount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          leading="₹"
          value={grossAmount}
          onChange={(e) => {
            setGrossAmount(e.target.value);
            clear("grossAmount");
          }}
          placeholder="0.00"
          className="tabular-nums"
        />
      </Field>
      <Field label="Date" error={errors.date}>
        <Input
          id="entry-date"
          name="date"
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => {
            setDate(e.target.value);
            clear("date");
          }}
        />
      </Field>
    </div>
  );

  const gstField = (
    <div data-field-error={errors.gstPercent ? "true" : undefined}>
      <Field label="GST %" error={errors.gstPercent}>
        <Input
          id="entry-gst"
          name="gstPercent"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          max="100"
          value={gstPercent}
          onChange={(e) => {
            setGstPercent(e.target.value);
            clear("gstPercent");
          }}
          className="tabular-nums"
        />
      </Field>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Common GST rates">
        {GST_PRESETS.map((rate) => {
          const active = Number(gstPercent) === rate && gstPercent !== "";
          return (
            <button
              key={rate}
              type="button"
              onClick={() => {
                setGstPercent(String(rate));
                clear("gstPercent");
              }}
              aria-pressed={active}
              className={`min-h-9 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset transition-colors sm:min-h-7 ${
                active
                  ? "bg-neutral-900 text-white ring-neutral-900 dark:bg-white dark:text-neutral-900 dark:ring-white"
                  : "bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50 dark:bg-white/[0.03] dark:text-neutral-300 dark:ring-white/15 dark:hover:bg-white/[0.06]"
              }`}
            >
              {rate === 0 ? "No GST" : `${rate}%`}
            </button>
          );
        })}
      </div>
    </div>
  );

  const categoryField = (
    <Field
      label="Category"
      optional
      error={errors.categoryName}
      hint={
        isNewCategory
          ? `"${trimmedCategory}" is new — it'll be added to ${business?.name}'s categories.`
          : trimmedCategory
            ? "Groups this entry in reports and the dashboard."
            : "Pick one or type a new one. Left empty, it goes under General."
      }
    >
      <Combobox
        id="entry-category"
        value={categoryName}
        onValueChange={(v) => {
          setCategoryName(v);
          clear("categoryName");
        }}
        options={(business?.categories ?? []).map((cat) => ({
          value: cat.name,
          hint: cat._count ? `${cat._count.expenses} ${cat._count.expenses === 1 ? "entry" : "entries"}` : undefined,
        }))}
        createLabel={(t) => `New category “${t}”`}
        emptyText="No categories yet — type one to add it"
        maxLength={60}
        placeholder={isOut ? "e.g. Rent, Travel, Salaries" : "e.g. Course sales"}
      />
    </Field>
  );

  const proofField = (
    <div>
      <p className="mb-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">{isOut ? "Bill or receipt" : "Proof of payment"}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-brand-400 hover:text-brand-700 sm:min-h-10 dark:border-white/15 dark:text-neutral-400 dark:hover:text-brand-300">
        <Upload className="h-4 w-4 shrink-0" />
        <span className={`truncate ${proofName ? "text-neutral-900 dark:text-neutral-100" : ""}`}>
          {proofName ?? (expense?.screenshotPath ? "Replace the saved proof" : "Choose an image or PDF")}
        </span>
        <input
          ref={proofInput}
          name="screenshot"
          type="file"
          accept="image/*,.pdf"
          className="sr-only"
          onChange={(e) => setProofName(e.target.files?.[0]?.name ?? null)}
        />
      </label>
    </div>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <input type="hidden" name="direction" value={direction} />
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-2 rounded-2xl border border-neutral-200/80 bg-white p-1.5 shadow-card sm:grid-cols-2 dark:border-white/[0.07] dark:bg-neutral-900/70">
          {(
            [
              { key: "IN", label: "Money in", hint: "Received via a gateway — charges and GST come off", icon: ArrowDownLeft, on: "bg-emerald-50 text-emerald-900 ring-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30" },
              { key: "OUT", label: "Money out", hint: "An expense the business paid, GST-inclusive", icon: ArrowUpRight, on: "bg-red-50 text-red-900 ring-red-300 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/30" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setDirection(opt.key);
                clear();
              }}
              aria-pressed={direction === opt.key}
              className={`flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                direction === opt.key ? `ring-1 ${opt.on}` : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-white/[0.04]"
              }`}
            >
              <opt.icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{opt.label}</span>
                <span className="block text-xs opacity-80">{opt.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <Card>
          <CardBody className="grid gap-5">
            {businesses.length > 1 && !isEdit ? (
              <Field label="Business" error={errors.businessId} hint="The entry is written into this business's Google Sheet too.">
                <Select id="entry-business" value={businessId} onChange={(e) => onBusinessChange(e.target.value)}>
                  {businesses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span className="h-2 w-2 rounded-full" style={{ background: business?.color }} />
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{business?.name}</span>
                <span className="text-xs">· also written to its Google Sheet</span>
              </p>
            )}

            {/* Screenshot first: on a phone it's usually faster than typing. */}
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-3 sm:flex-row sm:items-center dark:border-white/15 dark:bg-white/[0.02]">
              <ScanText className="hidden h-5 w-5 shrink-0 text-brand-600 sm:block dark:text-brand-300" />
              <p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">
                {scanning ? "Reading the screenshot…" : (scanNote ?? "Have a payment screenshot or a photo of the bill? Read the amount and date from it.")}
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={() => scanInput.current?.click()} disabled={scanning} className="shrink-0">
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                Read from screenshot
              </Button>
              <input
                ref={scanInput}
                type="file"
                accept="image/*"
                // Phones open the camera straight away; desktops get the file picker.
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void scan(f);
                }}
              />
            </div>

            <Field label={isOut ? "Expense" : "Description"} optional={!isOut} error={errors.description}>
              <Input
                id="entry-description"
                name="description"
                type="text"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clear("description");
                }}
                maxLength={500}
                autoFocus={!isEdit}
                placeholder={isOut ? "What was it for? e.g. Office rent — September, Printer ink" : "e.g. TagMango course sale"}
                className={isOut ? "text-base font-medium sm:text-sm" : ""}
              />
            </Field>

            {amountAndDate}

            {isOut ? (
              <>
                {gstField}
                <div className="grid gap-4 sm:grid-cols-2">
                  {categoryField}
                  {proofField}
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Payment gateway" error={errors.gatewayId}>
                    <Select id="entry-gateway" name="gatewayId" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
                      <option value="">None</option>
                      {business?.gateways.map((gw) => (
                        <option key={gw.id} value={gw.id}>
                          {gw.name} ({gw.chargePercent}%)
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {gstField}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {categoryField}
                  {proofField}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <Button type="button" variant="secondary" onClick={() => router.push("/money")}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} className="sm:order-first">
            {isEdit ? "Save changes" : isOut ? "Save expense" : "Save money in"}
          </Button>
        </div>
      </div>

      <Card className="border-brand-100 lg:sticky lg:top-20 dark:border-brand-950">
        <CardBody>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            <Receipt className="h-4 w-4 text-brand-600 dark:text-brand-300" />
            Breakup preview
          </h3>
          {isOut ? (
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-700 dark:text-neutral-300">
              {description.trim() && <dt className="col-span-2 truncate font-medium text-neutral-900 dark:text-neutral-100">{description.trim()}</dt>}
              <dt>Total incl. GST</dt>
              <dd className="text-right tabular-nums">{formatCurrency(Number(grossAmount) || 0)}</dd>
              <dt>GST ({gstPercent || 0}%, input credit)</dt>
              <dd className="text-right tabular-nums text-amber-700 dark:text-amber-400">− {formatCurrency(cost.gstAmount)}</dd>
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">Cost excl. GST</dt>
              <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-red-700 dark:border-white/[0.06] dark:text-red-400">
                {formatCurrency(cost.netAmount)}
              </dd>
            </dl>
          ) : (
            <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-700 dark:text-neutral-300">
              <dt>Gross amount</dt>
              <dd className="text-right tabular-nums">{formatCurrency(Number(grossAmount) || 0)}</dd>
              <dt>Gateway charge ({gatewayChargePercent}%)</dt>
              <dd className="text-right tabular-nums text-amber-700 dark:text-amber-400">− {formatCurrency(breakup.gatewayChargeAmount)}</dd>
              <dt>After gateway</dt>
              <dd className="text-right tabular-nums">{formatCurrency(breakup.afterGatewayAmount)}</dd>
              <dt>GST ({gstPercent || 0}%)</dt>
              <dd className="text-right tabular-nums text-amber-700 dark:text-amber-400">− {formatCurrency(breakup.gstAmount)}</dd>
              <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-white/[0.06] dark:text-neutral-100">Net revenue</dt>
              <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-emerald-600 dark:border-white/[0.06] dark:text-emerald-400">
                {formatCurrency(breakup.netAmount)}
              </dd>
            </dl>
          )}
        </CardBody>
      </Card>
    </form>
  );
}
