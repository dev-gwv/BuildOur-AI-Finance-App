"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Layers, Settings2 } from "lucide-react";

/** What the shell needs to know about a business (serialisable from the server). */
export type ShellBusiness = {
  id: string;
  name: string;
  slug: string;
  entity: string;
  color: string;
  needsReview: boolean;
};

const ENTITY_LABEL: Record<string, string> = {
  GRATEFUL: "Bills as Grateful World Ventures",
  MULBERRY: "Bills as The Mulberry Weddings",
};

/**
 * The business every page is scoped to. Each option is a plain link through
 * /scope, which sets the cookie and comes back to the same page — so it works
 * without JavaScript and needs no client state.
 */
export function BusinessSwitcher({
  businesses,
  current,
  isAdmin,
  pathname,
}: {
  businesses: ShellBusiness[];
  current: ShellBusiness | null;
  isAdmin: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  // A record page (an invoice's id) belongs to one business; switching away
  // should land on the list rather than a page the new scope may not own.
  const segments = pathname.split("/").filter(Boolean);
  const scopedRecord = ["invoices", "money"].includes(segments[0]) && segments.length > 1 && segments[1] !== "new";
  const safePath = scopedRecord ? `/${segments[0]}` : pathname;
  const href = (slug: string) => `/scope?b=${encodeURIComponent(slug)}&next=${encodeURIComponent(safePath || "/dashboard")}`;
  const anyReview = businesses.some((b) => b.needsReview);
  const single = businesses.length <= 1;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
          single ? "cursor-default" : "hover:bg-white/[0.06]"
        } border-white/[0.08] bg-white/[0.03]`}
        style={current ? { boxShadow: `inset 3px 0 0 ${current.color}`, background: `${current.color}14` } : undefined}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white ring-1 ring-white/15"
          style={{ background: current?.color ?? "linear-gradient(135deg,#6a6cf0,#0ea5e9 55%,#e11d48)" }}
        >
          {current ? current.name.replace(/^the\s+/i, "").slice(0, 1).toUpperCase() : <Layers className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{current?.name ?? "All businesses"}</span>
          <span className="block truncate text-[11px] text-zinc-400">
            {current ? ENTITY_LABEL[current.entity] ?? current.entity : `${businesses.length} businesses side by side`}
          </span>
        </span>
        {anyReview && isAdmin && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="A business needs review" />}
        {!single && <ChevronsUpDown className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-zinc-200" />}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(70vh,32rem)] animate-fade-up overflow-y-auto rounded-xl border border-white/10 bg-neutral-900 p-1 shadow-pop"
        >
          <SwitcherItem
            href={href("all")}
            active={!current}
            name="All businesses"
            hint="Everything you have access to"
            swatch={<Layers className="h-3.5 w-3.5 text-neutral-300" />}
          />
          <div className="my-1 h-px bg-white/[0.06]" />
          {businesses.map((b) => (
            <SwitcherItem
              key={b.id}
              href={href(b.slug)}
              active={current?.id === b.id}
              name={b.name}
              hint={ENTITY_LABEL[b.entity] ?? b.entity}
              review={isAdmin && b.needsReview}
              swatch={<span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />}
            />
          ))}
          {isAdmin && (
            <>
              <div className="my-1 h-px bg-white/[0.06]" />
              <Link
                href="/settings/businesses"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-400 hover:bg-white/[0.06] hover:text-white"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Manage businesses →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SwitcherItem({
  href,
  active,
  name,
  hint,
  swatch,
  review,
}: {
  href: string;
  active: boolean;
  name: string;
  hint: string;
  swatch: React.ReactNode;
  review?: boolean;
}) {
  return (
    <a
      href={href}
      role="option"
      aria-selected={active}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">{swatch}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-neutral-100">
          <span className="truncate">{name}</span>
          {review && (
            <span className="shrink-0 rounded bg-amber-400/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              Review
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] text-zinc-400">{hint}</span>
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-brand-300" />}
    </a>
  );
}
