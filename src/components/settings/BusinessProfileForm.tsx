"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, useFieldErrors } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  MAX_INVOICE_NUMBER_LENGTH,
  formatInvoiceNumber,
  hasFyToken,
  longestNumberFor,
  resolvePrefix,
} from "@/lib/invoiceNumbering";
import { request } from "./request";

export type EntityOption = { key: string; name: string; detail: string; gstRegistered?: boolean };

export type BusinessProfile = {
  id?: string;
  name: string;
  slug: string;
  entity: string;
  color: string;
  invoicePrefix: string;
  invoiceNextNumber: number;
  invoiceDigits?: number;
  creditNotePrefix?: string;
  defaultGstPercent: number;
};

type FieldName = "name" | "slug" | "invoicePrefix" | "invoiceNextNumber" | "invoiceDigits" | "creditNotePrefix" | "defaultGstPercent";

const SWATCHES = ["#6a6cf0", "#0ea5e9", "#e11d48", "#10b981", "#f59e0b", "#a855f7", "#525252", "#0f766e"];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** The April that starts the financial year `offset` years from today's. */
function fyStart(offset: number): Date {
  const now = new Date();
  const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(y + offset, 3, 1));
}

/**
 * Who the business is, who bills for it, and how its invoices and credit
 * notes are numbered. Used for both a new business and editing one.
 */
export function BusinessProfileForm({
  initial,
  entities,
  hasInvoices,
}: {
  initial: BusinessProfile;
  entities: EntityOption[];
  /** Once invoices exist, a changed prefix/entity only affects new ones — say so. */
  hasInvoices?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const isNew = !initial.id;
  const [form, setForm] = useState({ invoiceDigits: 6, creditNotePrefix: "CN/{FY}/", ...initial });
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [pending, setPending] = useState(false);
  const { errors, apply, clear } = useFieldErrors<FieldName>();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    clear(key as FieldName);
  };

  // An unregistered seller (Mulberry) charges no GST, so its rate would mean nothing.
  const gstRegistered = entities.find((e) => e.key === form.entity)?.gstRegistered ?? true;

  const prefix = form.invoicePrefix.trim().toUpperCase();
  const cnPrefix = form.creditNotePrefix.trim().toUpperCase();
  const digits = Number(form.invoiceDigits) || 6;
  const perYear = hasFyToken(prefix);
  const thisYear = formatInvoiceNumber(resolvePrefix(prefix, fyStart(0)), perYear ? 1 : Number(form.invoiceNextNumber) || 1, digits);
  const nextYear = formatInvoiceNumber(resolvePrefix(prefix, fyStart(1)), 1, digits);
  const firstNote = formatInvoiceNumber(resolvePrefix(cnPrefix, fyStart(0)), 1, Math.min(digits, 6));
  const invoiceLength = longestNumberFor(prefix, digits);
  const noteLength = longestNumberFor(cnPrefix, Math.min(digits, 6));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Caught here so the fix is next to the field, not after a round trip.
    const local: Partial<Record<FieldName, string>> = {};
    if (invoiceLength > MAX_INVOICE_NUMBER_LENGTH) local.invoicePrefix = `${invoiceLength} characters — GST allows ${MAX_INVOICE_NUMBER_LENGTH}. Shorten the prefix or use fewer digits.`;
    if (noteLength > MAX_INVOICE_NUMBER_LENGTH) local.creditNotePrefix = `${noteLength} characters — GST allows ${MAX_INVOICE_NUMBER_LENGTH}.`;
    if (Object.keys(local).length) {
      apply(local);
      return;
    }
    setPending(true);
    const body = {
      name: form.name,
      slug: slugify(form.slug),
      entity: form.entity,
      color: form.color,
      invoicePrefix: prefix,
      invoiceNextNumber: Number(form.invoiceNextNumber),
      invoiceDigits: digits,
      creditNotePrefix: cnPrefix,
      defaultGstPercent: Number(form.defaultGstPercent),
    };
    const result = isNew
      ? await request<{ business: { id: string } }>("/api/businesses", "POST", body)
      : await request(`/api/businesses/${initial.id}`, "PATCH", body);
    setPending(false);
    if (!result.ok) {
      apply(result.fields as Partial<Record<FieldName, string>>);
      toast.error(result.error);
      return;
    }
    toast.success(isNew ? "Business created" : "Saved");
    if (isNew) {
      const created = (result.data as { business?: { id: string } }).business;
      router.push(created ? `/settings/businesses/${created.id}` : "/settings/businesses");
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
            required
            maxLength={80}
            placeholder="IPC Finance"
          />
        </Field>
        <Field label="Short name (URL key)" error={errors.slug} hint="Lowercase letters, numbers and dashes. Old links like /ipc use it.">
          <Input
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value);
            }}
            onBlur={() => set("slug", slugify(form.slug))}
            required
            maxLength={40}
            placeholder="ipc"
            className="font-mono"
          />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Colour</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("color", c)}
              aria-pressed={form.color === c}
              className="flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 sm:h-7 sm:w-7 dark:ring-offset-neutral-900"
              style={{ background: c, boxShadow: form.color === c ? `0 0 0 2px ${c}` : undefined }}
              aria-label={`Use colour ${c}`}
            >
              {form.color === c && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
          ))}
          <input
            type="color"
            value={form.color}
            onChange={(e) => set("color", e.target.value)}
            // A round swatch like the presets beside it, with a "+" ring so it reads as "pick your own".
            className="h-9 w-9 cursor-pointer appearance-none rounded-full border-2 border-dashed border-neutral-300 bg-transparent p-0.5 sm:h-7 sm:w-7 dark:border-white/25 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
            aria-label="Custom colour"
            title="Pick any colour"
          />
        </div>
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">Used for its dot in the switcher, lists and charts.</p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Bills as</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {entities.map((ent) => {
            const selected = form.entity === ent.key;
            return (
              <button
                key={ent.key}
                type="button"
                onClick={() => set("entity", ent.key)}
                aria-pressed={selected}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? "border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10 dark:border-brand-400 dark:bg-brand-500/10"
                    : "border-neutral-200 hover:border-neutral-300 dark:border-white/10 dark:hover:border-white/20"
                }`}
              >
                <p className="flex items-center justify-between text-sm font-semibold text-neutral-900 dark:text-white">
                  {ent.name}
                  {selected && <Check className="h-4 w-4 text-brand-600 dark:text-brand-300" />}
                </p>
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{ent.detail}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          The seller printed on its invoices — name, GSTIN and bank.
          {hasInvoices && " Invoices already issued keep the seller they were issued under."}
        </p>
      </fieldset>

      <fieldset className="rounded-xl border border-neutral-200 p-4 dark:border-white/10">
        <legend className="px-1 text-sm font-semibold text-neutral-900 dark:text-white">Numbering</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Invoice prefix" error={errors.invoicePrefix} className="sm:col-span-1">
            <Input
              value={form.invoicePrefix}
              // Stored as typed and only shown upper-case: rewriting the value on
              // every keystroke would throw the caret to the end of the field.
              onChange={(e) => set("invoicePrefix", e.target.value)}
              onBlur={() => set("invoicePrefix", form.invoicePrefix.trim().toUpperCase())}
              required
              maxLength={16}
              placeholder="IPC/{FY}/"
              className="font-mono uppercase"
            />
          </Field>
          <Field label="Digits" error={errors.invoiceDigits} hint="Zero-padded, e.g. 4 → 0012">
            <Input
              type="number"
              min={3}
              max={8}
              step={1}
              value={form.invoiceDigits}
              onChange={(e) => set("invoiceDigits", Number(e.target.value))}
              inputMode="numeric"
              className="tabular-nums"
            />
          </Field>
          {perYear ? (
            <div className="text-sm">
              <p className="mb-1.5 font-medium text-neutral-800 dark:text-neutral-200">Next number</p>
              <p className="rounded-lg bg-neutral-50 px-3 py-2.5 text-xs text-neutral-700 dark:bg-white/[0.04] dark:text-neutral-300">
                Counted per financial year, from 1 each April — numbers already issued are skipped.
              </p>
            </div>
          ) : (
            <Field label="Next number" error={errors.invoiceNextNumber}>
              <Input
                type="number"
                min={1}
                step={1}
                value={form.invoiceNextNumber}
                onChange={(e) => set("invoiceNextNumber", Number(e.target.value))}
                inputMode="numeric"
                required
                className="tabular-nums"
              />
            </Field>
          )}
        </div>

        <div className="mt-3 flex gap-2 rounded-lg bg-brand-50/60 px-3 py-2.5 text-xs text-neutral-700 dark:bg-brand-500/10 dark:text-neutral-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-300" />
          <p>
            Put <code className="rounded bg-white px-1 font-mono dark:bg-white/10">{"{FY}"}</code> in the prefix to restart
            numbering every financial year — <span className="font-mono">IPC/{"{FY}"}/</span> gives{" "}
            <span className="font-mono">IPC/26-27/0001</span>. GST allows {MAX_INVOICE_NUMBER_LENGTH} characters in total.
          </p>
        </div>

        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-neutral-600 dark:text-neutral-400">{perYear ? "First invoice this year" : "Next invoice"}</dt>
            <dd className="mt-0.5 font-mono text-sm text-neutral-900 dark:text-white">{thisYear}</dd>
          </div>
          {perYear && (
            <div>
              <dt className="text-neutral-600 dark:text-neutral-400">First invoice next April</dt>
              <dd className="mt-0.5 font-mono text-sm text-neutral-900 dark:text-white">{nextYear}</dd>
            </div>
          )}
          <div>
            <dt className="text-neutral-600 dark:text-neutral-400">Length</dt>
            <dd
              className={`mt-0.5 text-sm tabular-nums ${invoiceLength > MAX_INVOICE_NUMBER_LENGTH ? "font-semibold text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-white"}`}
            >
              {invoiceLength} / {MAX_INVOICE_NUMBER_LENGTH}
            </dd>
          </div>
        </dl>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field
            label="Credit note prefix"
            error={errors.creditNotePrefix}
            hint={
              <>
                First one: <span className="font-mono">{firstNote}</span>
              </>
            }
          >
            <Input
              value={form.creditNotePrefix}
              onChange={(e) => set("creditNotePrefix", e.target.value)}
              onBlur={() => set("creditNotePrefix", form.creditNotePrefix.trim().toUpperCase())}
              maxLength={16}
              placeholder="CN/{FY}/"
              className="font-mono uppercase"
            />
          </Field>
          <Field
            label="Default GST %"
            error={errors.defaultGstPercent}
            hint={!gstRegistered ? "Not used — this entity isn't GST-registered, so no tax is charged." : undefined}
          >
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.defaultGstPercent}
              onChange={(e) => set("defaultGstPercent", Number(e.target.value))}
              inputMode="decimal"
              required
              disabled={!gstRegistered}
              className="tabular-nums"
            />
          </Field>
        </div>
        {hasInvoices && (
          <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
            A changed prefix applies to new invoices only; ones already issued keep their numbers.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" loading={pending}>
          {isNew ? "Create business" : "Save changes"}
        </Button>
        {isNew && (
          <Button type="button" variant="ghost" onClick={() => router.push("/settings/businesses")}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
