import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";

type Tone = "neutral" | "success" | "warning" | "danger";

const ICON_TONE: Record<Tone, string> = {
  neutral: "text-neutral-500 bg-neutral-100 dark:bg-white/[0.06] dark:text-neutral-400",
  success: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400",
  warning: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400",
  danger: "text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400",
};

const SPARK_COLOR: Record<Tone, string> = {
  neutral: "#6a6cf0",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
};

/**
 * One headline figure. `delta` is the % change against the previous period;
 * `invertDelta` flips its colour for figures where going up is bad (dues).
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  delta,
  invertDelta,
  trend,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: string;
  delta?: number | null;
  invertDelta?: boolean;
  trend?: number[];
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta! >= 0;
  const good = invertDelta ? !up : up;

  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
        {Icon && (
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${ICON_TONE[tone]}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="mt-3 truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums text-neutral-950 dark:text-white">
        {value}
      </p>
      <div className="mt-3 flex min-h-5 items-center gap-2 text-xs">
        {hasDelta && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums ${
              good
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
            }`}
          >
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta!).toFixed(Math.abs(delta!) < 10 ? 1 : 0)}%
          </span>
        )}
        {hint && <span className="truncate text-neutral-500 dark:text-neutral-400">{hint}</span>}
      </div>
      {trend && trend.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-80">
          <Sparkline data={trend} color={SPARK_COLOR[tone]} />
        </div>
      )}
    </Card>
  );
}
