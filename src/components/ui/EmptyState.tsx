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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
      )}
      {action}
    </div>
  );
}
