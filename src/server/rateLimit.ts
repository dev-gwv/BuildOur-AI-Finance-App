import { prisma } from "@/lib/prisma";
import { ApiError } from "./errors";

/**
 * Fixed-window rate limiting shared by every serverless instance, kept in
 * Postgres (one row per key) since there's no Redis. One atomic upsert per
 * check: a new window resets the count, otherwise it increments.
 *
 * Fails open: if the counter can't be read, the request goes through — a
 * database hiccup must not lock everyone out of signing in.
 */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  try {
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."windowStart" < NOW() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimit"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimit"."windowStart" < NOW() - make_interval(secs => ${windowSeconds}) THEN NOW() ELSE "RateLimit"."windowStart" END
      RETURNING "count", "windowStart"`;
    const { count, windowStart } = rows[0];
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
    return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfter };
  } catch (e) {
    console.error("Rate limiter unavailable, allowing request:", e);
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/**
 * Whether a key is already over its limit, without counting this request —
 * for limits that should only count failures (see login in src/lib/auth.ts).
 */
export async function isLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const row = await prisma.rateLimit.findUnique({ where: { key } });
    if (!row) return false;
    const expired = row.windowStart.getTime() + windowSeconds * 1000 < Date.now();
    return !expired && row.count >= limit;
  } catch {
    return false;
  }
}

/** Clears a key, e.g. a user's failed-login counter after they sign in. */
export async function reset(key: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key } }).catch(() => {});
}

/** The limits the app enforces, in one place so they're easy to tune. */
export const LIMITS = {
  /** Sign-in attempts per account (cleared on success), and failed ones per network address. */
  loginPerEmail: { limit: 5, window: 15 * 60 },
  loginPerIp: { limit: 30, window: 15 * 60 },
  /** Emails a user can send customers per hour (a leaked session can't spam). */
  emailPerUser: { limit: 30, window: 60 * 60 },
  /** Document/screenshot reading, which is CPU-heavy. */
  parsePerUser: { limit: 60, window: 10 * 60 },
  /** Calls through to Razorpay's API. */
  razorpayPerUser: { limit: 60, window: 60 },
  /** Any other write, generously — catches runaway scripts, not people. */
  writesPerUser: { limit: 300, window: 60 },
} as const;

/** Throws a 429 when over the limit. */
export async function enforce(name: keyof typeof LIMITS, subject: string): Promise<void> {
  const { limit, window } = LIMITS[name];
  const result = await hit(`${name}:${subject}`, limit, window);
  if (!result.ok) {
    const minutes = Math.ceil(result.retryAfter / 60);
    throw new ApiError(
      429,
      `Too many attempts. Please wait ${minutes <= 1 ? "a minute" : `${minutes} minutes`} and try again.`,
      undefined,
      result.retryAfter
    );
  }
}

/** Best-effort client address from the proxy headers Vercel sets. */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
