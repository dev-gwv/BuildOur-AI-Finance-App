/** A placeholder block that pulses while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-neutral-200/70 dark:bg-white/[0.06] ${className}`} />;
}
