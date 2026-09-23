type Tone = "neutral" | "success" | "warning" | "danger" | "brand";
/** "indigo" is the old name for "brand", kept so existing callers keep working. */
type ToneProp = Tone | "indigo";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-white/[0.06] dark:text-neutral-300 dark:ring-white/10",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  danger: "bg-red-50 text-red-700 ring-red-200/70 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20",
  brand: "bg-brand-50 text-brand-700 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/20",
};

const DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-neutral-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  brand: "bg-brand-500",
};

export function Badge({
  tone = "neutral",
  dot,
  children,
}: {
  tone?: ToneProp;
  /** A status dot before the label, for states rather than categories. */
  dot?: boolean;
  children: React.ReactNode;
}) {
  const t: Tone = tone === "indigo" ? "brand" : tone;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASSES[t]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[t]}`} />}
      {children}
    </span>
  );
}
