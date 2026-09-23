"use client";

import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; message: string };

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

// A neutral card with a coloured icon reads calmer than a full tinted box,
// and stays legible on both the light and the dark canvas.
const ICON_STYLES: Record<ToastKind, string> = {
  success: "text-emerald-500",
  error: "text-red-500",
  info: "text-brand-500",
};

/**
 * Success and info fade on their own; an error stays until it's dismissed —
 * "already recorded on INV-001122" must not vanish before it's read.
 */
const DURATION: Record<ToastKind, number | null> = { success: 4500, info: 6000, error: null };
/** More than this and the oldest go, so a burst can't cover the screen. */
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, kind, message }].slice(-MAX_VISIBLE));
      const ms = DURATION[kind];
      if (ms) setTimeout(() => dismiss(id), ms);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Full-width at the bottom on phones; bottom-right on larger screens. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-stretch gap-2 sm:left-auto sm:right-5 sm:bottom-5 sm:w-96 print:hidden">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <div
              key={toast.id}
              role={toast.kind === "error" ? "alert" : "status"}
              className="pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border border-neutral-200/80 bg-white/95 px-4 py-3 text-sm text-neutral-800 shadow-pop backdrop-blur dark:border-white/10 dark:bg-neutral-900/95 dark:text-neutral-100"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_STYLES[toast.kind]}`} />
              <span className="flex-1 leading-5">{toast.message}</span>
              <button
                onClick={() => dismiss(toast.id)}
                className="-my-1.5 -mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
