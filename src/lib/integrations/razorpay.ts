import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import { normalizeRazorpayPayment, type RawPayment, type RazorpayPayment } from "./razorpayPayment";

export type { RazorpayPayment };

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
const API = "https://api.razorpay.com/v1";

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

/** The stored credentials, when the integration is switched on and the secret opens. */
export async function getRazorpayCredentials(): Promise<{ keyId: string; keySecret: string } | null> {
  const row = await prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER } });
  if (!row?.enabled || !row.keyId || !row.secretEnc) return null;
  const keySecret = openSecret(row.secretEnc);
  return keySecret ? { keyId: row.keyId, keySecret } : null;
}

export async function isRazorpayConnected(): Promise<boolean> {
  return (await getRazorpayCredentials()) !== null;
}

/** Throws RazorpayError if the keys don't work. Used before saving them. */
export async function testRazorpayCredentials(keyId: string, keySecret: string): Promise<void> {
  await request(`/payments?count=1`, keyId, keySecret);
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  if (!/^pay_[A-Za-z0-9]{14}$/.test(paymentId)) throw new RazorpayError("That isn't a Razorpay payment ID (pay_ + 14 characters)", 400);
  const creds = await getRazorpayCredentials();
  if (!creds) throw new RazorpayError("Razorpay isn't connected — turn it on in Settings → Integrations", 409);
  return normalizeRazorpayPayment(await request<RawPayment>(`/payments/${paymentId}`, creds.keyId, creds.keySecret));
}

/** Captured payments from the last `days` days, newest first. */
export async function listRecentRazorpayPayments(days = 14, count = 50): Promise<RazorpayPayment[]> {
  const creds = await getRazorpayCredentials();
  if (!creds) throw new RazorpayError("Razorpay isn't connected — turn it on in Settings → Integrations", 409);
  const from = Math.floor(Date.now() / 1000) - days * 86_400;
  const page = await request<{ items: RawPayment[] }>(`/payments?from=${from}&count=${count}`, creds.keyId, creds.keySecret);
  return page.items.filter((p) => p.status === "captured").map(normalizeRazorpayPayment);
}

export function maskKeyId(keyId: string | null): string | null {
  if (!keyId) return null;
  return keyId.length > 12 ? `${keyId.slice(0, 9)}…${keyId.slice(-4)}` : keyId;
}
