"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { hintClass, inputClass, labelClass, request } from "./request";

export type EntityOption = { key: string; name: string; detail: string };

export type BusinessProfile = {
  id?: string;
  name: string;
  slug: string;
  entity: string;
  color: string;
  invoicePrefix: string;
  invoiceNextNumber: number;
  defaultGstPercent: number;
};

const SWATCHES = ["#6a6cf0", "#0ea5e9", "#e11d48", "#10b981", "#f59e0b", "#a855f7", "#525252", "#0f766e"];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * Who the business is, who bills for it, and how its invoices are numbered.
 * Used for both a new business and editing one.
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
  const [form, setForm] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [fields, setFields] = useState<Record<string, string>>();
  const [pending, setPending] = useState(false);

  const set = <K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const preview = `${form.invoicePrefix}${String(form.invoiceNextNumber || 1).padStart(6, "0")}`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setFields(undefined);
    const body = {
      name: form.name,
      slug: form.slug,
      entity: form.entity,
      color: form.color,
      invoicePrefix: form.invoicePrefix,
      invoiceNextNumber: Number(form.invoiceNextNumber),
      defaultGstPercent: Number(form.defaultGstPercent),
    };
    const result = isNew
      ? await request<{ business: { id: string } }>("/api/businesses", "POST", body)
      : await request(`/api/businesses/${initial.id}`, "PATCH", body);
    setPending(false);
    if (!result.ok) {
      setFields(result.fields);
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

  const err = (name: string) => fields?.[name] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fields[name]}</p>;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Name
          <input
            value={form.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
            required
            maxLength={80}
            placeholder="IPC Finance"
            className={inputClass}
          />
          {err("name")}
        </label>
        <label className={labelClass}>
          Short name (URL key)
          <input
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", slugify(e.target.value));
            }}
            required
            maxLength={40}
            placeholder="ipc"
            className={`${inputClass} font-mono`}
          />
          <p className={hintClass}>Lowercase letters, numbers and dashes. Old links like /ipc use it.</p>
          {err("slug")}
        </label>
      </div>

      <div>
        <p className={labelClass}>Colour</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("color", c)}
              className="flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-neutral-900"
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
            className="h-7 w-10 cursor-pointer rounded border border-neutral-200 bg-white dark:border-white/10"
            aria-label="Custom colour"
          />
        </div>
        <p className={hintClass}>Used for its dot in the switcher, lists and charts.</p>
      </div>

      <div>
        <p className={labelClass}>Bills as</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {entities.map((ent) => {
            const selected = form.entity === ent.key;
            return (
              <button
                key={ent.key}
                type="button"
                onClick={() => set("entity", ent.key)}
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
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{ent.detail}</p>
              </button>
            );
          })}
        </div>
        <p className={hintClass}>
          The seller printed on its invoices — name, GSTIN and bank.
          {hasInvoices && " Invoices already issued keep the seller they were issued under."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          Invoice prefix
          <input
            value={form.invoicePrefix}
            onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
            required
            maxLength={20}
            placeholder="IPC-INV-"
            className={`${inputClass} font-mono`}
          />
          {err("invoicePrefix")}
        </label>
        <label className={labelClass}>
          Next number
          <input
            type="number"
            min={1}
            step={1}
            value={form.invoiceNextNumber}
            onChange={(e) => set("invoiceNextNumber", Number(e.target.value))}
            required
            className={`${inputClass} tabular-nums`}
          />
          {err("invoiceNextNumber")}
        </label>
        <label className={labelClass}>
          Default GST %
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={form.defaultGstPercent}
            onChange={(e) => set("defaultGstPercent", Number(e.target.value))}
            required
            className={`${inputClass} tabular-nums`}
          />
          {err("defaultGstPercent")}
        </label>
      </div>
      <p className="-mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Next invoice will be numbered{" "}
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200">
          {preview}
        </span>
        {hasInvoices && " — a number that's already been issued is skipped automatically, so none can repeat."}
      </p>

      <div className="flex items-center gap-2">
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
