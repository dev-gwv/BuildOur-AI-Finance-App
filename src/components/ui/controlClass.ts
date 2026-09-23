/**
 * One look for every form control. 44px tall on phones (a comfortable touch
 * target), 40px from sm up; a visible focus ring; red border + ring when the
 * field has an error.
 *
 * Kept out of Field.tsx (a client module) so server pages can use it too: a
 * function imported from a "use client" file reaches a server component as a
 * reference, not something it can call.
 */
const BASE =
  "block w-full rounded-lg border bg-white px-3 text-sm text-neutral-900 shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-neutral-500 focus:ring-4 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500 dark:bg-neutral-950/60 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:disabled:bg-white/[0.03]";
const OK = "border-neutral-300 focus:border-brand-500 focus:ring-brand-500/15 dark:border-white/15";
const BAD = "border-red-400 focus:border-red-500 focus:ring-red-500/15 dark:border-red-500/60";

/** The shared control class, for the rare control that can't use the components in Field.tsx. */
export function controlClass(invalid = false, extra = ""): string {
  return `${BASE} ${invalid ? BAD : OK} ${extra}`.trim();
}
