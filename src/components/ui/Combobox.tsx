"use client";

import { forwardRef, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { controlClass } from "@/components/ui/Field";

export type ComboOption = { value: string; hint?: string };

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> & {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboOption[] | string[];
  invalid?: boolean;
  /** Free text is allowed; when it matches no option, the list offers to add it. */
  allowCreate?: boolean;
  createLabel?: (text: string) => string;
  emptyText?: string;
};

/**
 * A text box with a styled suggestion list — the replacement for the native
 * <datalist>, whose popup can't be styled and looks different in every
 * browser. Typing filters; ↑/↓ move, Enter picks, Escape closes. Anything
 * typed is kept even if it isn't in the list (allowCreate), so it can also add
 * new values (a new category, a payment method we haven't seen).
 */
export const Combobox = forwardRef<HTMLInputElement, Props>(function Combobox(
  {
    value,
    onValueChange,
    options,
    invalid,
    allowCreate = true,
    createLabel = (t) => `Add “${t}”`,
    emptyText = "No matches",
    className = "",
    onFocus,
    onBlur,
    onKeyDown,
    ...rest
  },
  ref
) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // -1 = nothing highlighted yet: typing never pre-selects, so the first ↓
  // lands on the first match and Enter on plain text keeps what was typed.
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const normalized = useMemo<ComboOption[]>(
    () => options.map((o) => (typeof o === "string" ? { value: o } : o)),
    [options]
  );
  const query = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? normalized.filter((o) => o.value.toLowerCase().includes(query)) : normalized),
    [normalized, query]
  );
  const exact = normalized.some((o) => o.value.toLowerCase() === query);
  const showCreate = allowCreate && query.length > 0 && !exact;
  const items: Array<{ kind: "option"; option: ComboOption } | { kind: "create" }> = [
    ...filtered.map((option) => ({ kind: "option" as const, option })),
    ...(showCreate ? [{ kind: "create" as const }] : []),
  ];

  // Close when focus or a click leaves the whole control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view while moving with the keyboard.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(index: number) {
    const item = items[index];
    if (!item) {
      // Enter with nothing highlighted: an exact match (any case) takes the
      // option's own spelling; anything else stays as typed.
      const match = normalized.find((o) => o.value.toLowerCase() === query);
      if (match) onValueChange(match.value);
      setOpen(false);
      return;
    }
    onValueChange(item.kind === "option" ? item.option.value : value.trim());
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={ref}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          setActive(-1);
          onFocus?.(e);
        }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "Tab") {
            setOpen(false);
          }
          onKeyDown?.(e);
        }}
        className={controlClass(invalid, `h-11 pr-9 sm:h-10 ${className}`)}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Close suggestions" : "Show suggestions"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-64 w-full animate-fade-up overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop dark:border-white/10 dark:bg-neutral-900"
        >
          {items.length === 0 && <li className="px-3 py-2 text-sm text-neutral-500">{emptyText}</li>}
          {items.map((item, i) => {
            const selected = item.kind === "option" && item.option.value.toLowerCase() === query;
            return (
              <li
                key={item.kind === "option" ? item.option.value : "__create"}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                  i === active
                    ? "bg-neutral-100 text-neutral-900 dark:bg-white/[0.07] dark:text-white"
                    : "text-neutral-700 dark:text-neutral-300"
                }`}
              >
                {item.kind === "create" ? (
                  <>
                    <Plus className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                    <span className="font-medium text-brand-700 dark:text-brand-300">{createLabel(value.trim())}</span>
                  </>
                ) : (
                  <>
                    <span className={`min-w-0 flex-1 truncate ${selected ? "font-semibold" : ""}`}>{item.option.value}</span>
                    {item.option.hint && <span className="shrink-0 text-xs text-neutral-500">{item.option.hint}</span>}
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
