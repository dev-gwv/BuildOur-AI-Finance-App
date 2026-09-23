"use client";

import { controlClass } from "@/components/ui/Field";

/**
 * One way for settings forms to call the API: JSON in, JSON out, and the
 * server's own message (plus per-field messages) back on failure, so every
 * form reports errors the same way.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields?: Record<string, string> };

export async function request<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: (data as { error?: string }).error ?? `Something went wrong (${res.status})`,
        fields: (data as { fields?: Record<string, string> }).fields,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }
}

/** The shared control look (see components/ui/Field) for forms not yet on <Field>. */
export const inputClass = `mt-1.5 ${controlClass(false, "h-11 sm:h-10")}`;
export const labelClass = "block text-sm font-medium text-neutral-800 dark:text-neutral-200";
export const hintClass = "mt-1.5 text-xs text-neutral-600 dark:text-neutral-400";

/** Field-level error line under an input. */
export function fieldError(fields: Record<string, string> | undefined, name: string) {
  return fields?.[name];
}
