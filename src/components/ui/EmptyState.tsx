import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300/80 bg-white/50 px-6 py-14 text-center dark:border-white/10 dark:bg-white/[0.02]">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-neutral-500 shadow-card ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-white/10">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
      )}
      {action}
    </div>
  );
}
