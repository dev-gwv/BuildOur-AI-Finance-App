// Controls that sit in a list's filter bar, next to the segmented filters:
// same height (40px, 44px on phones), radius and card shadow as those, so a
// toolbar reads as one row. Form fields elsewhere use src/components/ui/Field.

const BASE =
  "h-11 rounded-xl border border-neutral-200/80 bg-white text-sm text-neutral-900 shadow-card outline-none transition-[border-color,box-shadow] placeholder:text-neutral-500 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 sm:h-10 dark:border-white/10 dark:bg-neutral-900/70 dark:text-neutral-100";

/** A filter dropdown (the global layer adds the chevron and its room). */
export const filterSelectClass = `${BASE} pl-3`;

/** A search box with a leading magnifier (place the icon with searchIconClass). */
export const filterSearchClass = `${BASE} w-full pl-9 pr-3 [&::-webkit-search-cancel-button]:cursor-pointer`;

export const searchIconClass =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400";

/** The toolbar's submit button, matching the controls' height. */
export const filterButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 transition-colors hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:h-10 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200";
