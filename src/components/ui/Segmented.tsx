import Link from "next/link";
import type { ComponentProps } from "react";

type Href = ComponentProps<typeof Link>["href"];

/** A row of mutually exclusive filters, driven by the URL so it works without JS. */
export function Segmented({
  items,
  className = "",
}: {
  items: { key: string; label: React.ReactNode; href: Href; active: boolean }[];
  className?: string;
}) {
  return (
    <div
      className={`inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-neutral-200/80 bg-white p-0.5 shadow-card dark:border-white/[0.07] dark:bg-neutral-900/70 ${className}`}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          className={`whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
            item.active
              ? "bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
