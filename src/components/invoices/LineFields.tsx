"use client";

import { useCallback, useState, type ReactNode } from "react";
import { controlClass } from "@/components/ui/Field";

// Form pieces shared by the three invoice forms (new, Mulberry, edit): one
// input style, inline field errors keyed by the API's `fields` response, and
// focusing the first invalid field — so a problem is shown where it is, not
// only in a toast that disappears.

// The shared control look (src/components/ui/Field.tsx) plus the red state
// these forms drive through aria-invalid (see useFieldErrors below).
const INVALID =
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-500 aria-[invalid=true]:focus:ring-red-500/15 dark:aria-[invalid=true]:border-red-500/60";

/** Text inputs and selects: 44px on phones, 40px from sm up. */
export const inputClass = `${controlClass(false, "mt-1 h-11 sm:h-10")} ${INVALID}`;

/** Multi-line text: same border, focus and radius, natural height. */
export const textareaClass = `${controlClass(false, "mt-1 py-2.5")} ${INVALID}`;

/** A money input inside <Rupee>: room for the ₹ sign, figures aligned. */
export const moneyInputClass = `${controlClass(false, "h-11 pl-7 tabular-nums sm:h-10")} ${INVALID}`;

export const labelClass = "block text-sm font-medium text-neutral-800 dark:text-neutral-200";

export const hintClass = "mt-1.5 text-xs text-neutral-600 dark:text-neutral-400";

/** A tickable row: the whole row is the target (44px+), highlighted when ticked. */
export const checkRowClass =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 transition-colors hover:border-brand-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50/60 dark:border-white/10 dark:bg-neutral-950/40 dark:text-neutral-200 dark:hover:border-brand-500/40 dark:has-[:checked]:border-brand-500/40 dark:has-[:checked]:bg-brand-500/10";

/** Prefixes a money input (moneyInputClass) with a ₹ sign, like the shared Input's `leading`. */
export function Rupee({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-1">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500 dark:text-neutral-400">
        ₹
      </span>
      {children}
    </div>
  );
}

export type FieldErrors = Record<string, string>;

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

/**
 * Field error state for a form. `props(name)` gives an input its
 * aria-invalid/aria-describedby and `data-field` so `focusFirst` can find it.
 */
export function useFieldErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});

  const clear = useCallback((name: string) => {
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const props = useCallback(
    (name: string) => ({
      "data-field": name,
      "aria-invalid": errors[name] ? true : undefined,
      "aria-describedby": errors[name] ? `err-${name}` : undefined,
    }),
    [errors]
  );

  return { errors, setErrors, clear, props };
}

/** Scrolls to and focuses the first field with an error, opening a collapsed <details> around it. */
export function focusFirstError(form: HTMLElement | null, errors: FieldErrors) {
  if (!form) return;
  const names = Object.keys(errors);
  if (names.length === 0) return;
  // In document order, not the order the server listed them.
  const fields = [...form.querySelectorAll<HTMLElement>("[data-field]")];
  const target = fields.find((el) => names.includes(el.dataset.field ?? ""));
  if (!target) return;
  const details = target.closest("details");
  if (details && !details.open) details.open = true;
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  });
}
