import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import { normalizeRazorpayPayment, type RawPayment, type RazorpayPayment } from "./razorpayPayment";
import { importStats, storedPayment, storedPaymentsBetween } from "./storedPayments";

export type { RazorpayPayment };
export { matchRazorpayPayment } from "./razorpayPayment";

/**
 * Razorpay, read-only. When connected (Settings -> Integrations), a payment's
 * exact commission and the GST on it come from Razorpay itself instead of being
 * estimated from a percentage, and recent Razorpay payments can be picked
 * straight into an invoice without a screenshot.
 *
 * Only GET endpoints are used. A key with read access is enough; nothing here
 * can move money.
 */

export const RAZORPAY_PROVIDER = "razorpay";
// Overridable only so tests can point it at a stand-in.
const API = process.env.RAZORPAY_API_URL || "https://api.razorpay.com/v1";

export class RazorpayError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, keyId: string, keySecret: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
      cache: "no-store",
    });
  } catch {
    throw new RazorpayError("Couldn't reach Razorpay — check the connection and try again", 502);
  }
  if (res.status === 401) throw new RazorpayError("Razorpay rejected the API key — check the Key ID and Key Secret", 401);
  if (res.status === 404) throw new RazorpayError("Razorpay has no payment with that ID", 404);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { description?: string } } | null;
    throw new RazorpayError(body?.error?.description ?? `Razorpay answered ${res.status}`, 502);
  }
  return (await res.json()) as T;
}

/** The stored credentials, when the integration is switched on, by API key, and the secret opens. */
export async function getRazorpayCredentials(): Promise<{ keyId: string; keySecret: string } | null> {
  const row = await prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER } });
  if (!row?.enabled || row.mode === "file" || !row.keyId || !row.secretEnc) return null;
  const keySecret = openSecret(row.secretEnc);
  return keySecret ? { keyId: row.keyId, keySecret } : null;
}

/** Where Razorpay payments come from: its API, uploaded reports, or nowhere yet. */
export async function razorpaySource(): Promise<"api" | "file" | null> {
  const row = await prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER }, select: { enabled: true, mode: true } });
  if (row?.enabled && row.mode === "file") return "file";
  return (await getRazorpayCredentials()) ? "api" : null;
}

export async function isRazorpayConnected(): Promise<boolean> {
  return (await razorpaySource()) !== null;
}

/** Throws RazorpayError if the keys don't work. Used before saving them. */
export async function testRazorpayCredentials(keyId: string, keySecret: string): Promise<void> {
  await request(`/payments?count=1`, keyId, keySecret);
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  if (!/^pay_[A-Za-z0-9]{14}$/.test(paymentId)) throw new RazorpayError("That isn't a Razorpay payment ID (pay_ + 14 characters)", 400);
  if ((await razorpaySource()) === "file") {
    const stored = await storedPayment(RAZORPAY_PROVIDER, paymentId);
    if (!stored) throw new RazorpayError("That payment isn't in the uploaded Razorpay reports — upload a newer report", 404);
    return stored;
  }
  const creds = await getRazorpayCredentials();
  if (!creds) throw new RazorpayError("Razorpay isn't connected — turn it on in Settings → Integrations", 409);
  return normalizeRazorpayPayment(await request<RawPayment>(`/payments/${paymentId}`, creds.keyId, creds.keySecret));
}

/**
 * Captured payments made between two dates (YYYY-MM-DD, IST, inclusive), all
 * pages of them, up to `max`.
 */
export async function listRazorpayPaymentsBetween(fromDay: string, toDay: string, max = 2000): Promise<RazorpayPayment[]> {
  if ((await razorpaySource()) === "file") return storedPaymentsBetween(RAZORPAY_PROVIDER, fromDay, toDay, max);
  const creds = await getRazorpayCredentials();
  if (!creds) throw new RazorpayError("Razorpay isn't connected — turn it on in Settings → Integrations", 409);
  // IST midnight is 18:30 UTC the day before.
  const from = Math.floor(Date.parse(`${fromDay}T00:00:00+05:30`) / 1000);
  const to = Math.floor(Date.parse(`${toDay}T23:59:59+05:30`) / 1000);
  const out: RazorpayPayment[] = [];
  for (let skip = 0; skip < max; skip += 100) {
    const page = await request<{ items: RawPayment[] }>(
      `/payments?from=${from}&to=${to}&count=100&skip=${skip}`,
      creds.keyId,
      creds.keySecret
    );
    out.push(...page.items.map(normalizeRazorpayPayment));
    if (page.items.length < 100) break;
  }
  return out.filter((p) => p.status === "captured");
}

/** A YYYY-MM-DD day moved by whole days. */
export const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** What the settings card and payment form may know: never the secret. */
export async function razorpayStatus() {
  const row = await prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER } });
  const secretOpens = row?.secretEnc ? openSecret(row.secretEnc) !== null : false;
  const mode = (row?.mode === "file" ? "file" : "api") as "api" | "file";
  const imports = await importStats(RAZORPAY_PROVIDER);
  return {
    mode,
    imports,
    enabled: row?.enabled ?? false,
    connected: Boolean(row?.enabled && (mode === "file" ? imports.count > 0 : row.keyId && secretOpens)),
    hasKeys: Boolean(row?.keyId && row?.secretEnc),
    // The secret couldn't be decrypted — AUTH_SECRET changed since it was saved.
    needsReentry: Boolean(row?.secretEnc && !secretOpens),
    keyId: maskKeyId(row?.keyId ?? null),
    keyMode: (row?.keyId?.startsWith("rzp_test_") ? "test" : row?.keyId ? "live" : null) as "test" | "live" | null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
  };
}

export function maskKeyId(keyId: string | null): string | null {
  if (!keyId) return null;
  return keyId.length > 12 ? `${keyId.slice(0, 9)}…${keyId.slice(-4)}` : keyId;
}
