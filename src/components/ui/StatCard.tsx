import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

type Tone = "neutral" | "success" | "warning" | "danger";

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400",
  success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  danger: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {value}
          </p>
          {hint && <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ICON_TONE[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
