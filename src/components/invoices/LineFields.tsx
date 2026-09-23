"use client";

import { useCallback, useState } from "react";

// Form pieces shared by the three invoice forms (new, Mulberry, edit): one
// input style, inline field errors keyed by the API's `fields` response, and
// focusing the first invalid field — so a problem is shown where it is, not
// only in a toast that disappears.

export const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-xs outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-500 aria-[invalid=true]:focus:ring-red-500/15 dark:border-white/10 dark:bg-neutral-950/60 dark:aria-[invalid=true]:border-red-500/60";

export const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export const hintClass = "mt-1 text-xs text-neutral-500 dark:text-neutral-400";

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
