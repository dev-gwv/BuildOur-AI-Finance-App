/**
 * A same-site path to send someone to after an action, or the fallback.
 * Rejects absolute URLs and protocol-relative ones — including "/\evil.com",
 * which browsers treat like "//evil.com" — so no link can bounce a user to
 * another site with our domain in the address bar.
 */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
