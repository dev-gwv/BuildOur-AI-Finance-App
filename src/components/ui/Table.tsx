import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

// Shared table styling so every list reads the same: quiet header, hairline
// rows, numbers right-aligned in tabular figures.

export function Table({ className = "", ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full text-sm ${className}`} {...rest} />;
}

export function THead({ className = "", ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={`border-b border-neutral-200/80 bg-neutral-50/70 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-neutral-400 ${className}`}
      {...rest}
    />
  );
}

export function TH({ className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={`px-4 py-2.5 font-medium ${className}`} {...rest} />;
}

export function TBody({ className = "", ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`divide-y divide-neutral-100 dark:divide-white/[0.05] ${className}`} {...rest} />;
}

export function TR({ className = "", ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`transition-colors hover:bg-neutral-50/80 dark:hover:bg-white/[0.02] ${className}`} {...rest} />;
}

export function TD({ className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 text-neutral-600 dark:text-neutral-400 ${className}`} {...rest} />;
}
