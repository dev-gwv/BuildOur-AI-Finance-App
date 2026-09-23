"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { controlClass } from "./controlClass";

export { controlClass };

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; /** A symbol inside the start of the box, e.g. "₹". */ leading?: ReactNode }
>(function Input({ invalid, leading, className = "", ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={controlClass(invalid, `h-11 sm:h-10 ${leading ? "pl-7" : ""} ${className}`)}
      {...rest}
    />
  );
  if (!leading) return input;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500 dark:text-neutral-400" aria-hidden>
        {leading}
      </span>
      {input}
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className = "", children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={controlClass(invalid, `h-11 pr-8 sm:h-10 ${className}`)}
        {...rest}
      >
        {children}
      </select>
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className = "", ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={controlClass(invalid, `py-2.5 ${className}`)}
        {...rest}
      />
    );
  }
);

/**
 * Label + control + hint + error, wired for screen readers: the control gets
 * an id, aria-invalid and aria-describedby pointing at the hint/error. Pass a
 * single Input/Select/Textarea (or any element accepting id/aria props).
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className = "",
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
  /** Use when the control already has an id you can't change. */
  htmlFor?: string;
}) {
  const auto = useId();
  const childId = (isValidElement(children) && (children.props.id as string | undefined)) || htmlFor || `f${auto}`;
  const hintId = hint ? `${childId}-hint` : undefined;
  const errorId = error ? `${childId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: childId,
        "aria-describedby": describedBy,
        ...(error ? { invalid: true, "aria-invalid": true } : {}),
      })
    : children;

  return (
    <div className={className} data-field-error={error ? "true" : undefined}>
      <label htmlFor={childId} className="mb-1.5 block text-sm font-medium text-neutral-800 dark:text-neutral-200">
        {label}
        {optional && <span className="ml-1 font-normal text-neutral-500 dark:text-neutral-400">(optional)</span>}
      </label>
      {control}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Per-field errors from the API ({ error, fields }). `apply` stores them and
 * brings the first invalid field into view and focus, so an error below the
 * fold is never missed; `clear(name)` drops one as the user fixes it.
 */
export function useFieldErrors<K extends string = string>() {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});

  const apply = useCallback((fields: Partial<Record<K, string>> | undefined | null) => {
    setErrors(fields ?? {});
    if (!fields || !Object.keys(fields).length) return;
    // After React paints the error state.
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>('[data-field-error="true"] input, [data-field-error="true"] select, [data-field-error="true"] textarea, [aria-invalid="true"]');
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        first.focus({ preventScroll: true });
      }
    });
  }, []);

  const clear = useCallback((name?: K) => {
    setErrors((prev) => {
      if (!name) return {};
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  return { errors, apply, clear, setErrors };
}
