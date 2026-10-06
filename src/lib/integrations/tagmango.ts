import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import { normalizeTagMangoTransaction, type RawTagMangoTransaction, type TagMangoPayment } from "./tagmangoPayment";

export type { TagMangoPayment };

/**
 * TagMango, read-only. When connected (Settings -> Integrations), payments
 * made on TagMango can be picked straight into an invoice with their exact
 * amount, GST and TagMango's commission, like Razorpay's.
 *
 * TagMango identifies the creator by the dashboard's host name (sent as
 * x-whitelabel-host) and authenticates with an API key TagMango's account
 * manager issues on the Ultimate plan. Only the transactions listing is used;
 * it's a POST but only reads.
 */

export const TAGMANGO_PROVIDER = "tagmango";
// Overridable only so tests can point it at a stand-in.
const API = process.env.TAGMANGO_API_URL || "https://api-prod-new.tagmango.com/api/v1/external";

export class TagMangoError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

type Page = { data: RawTagMangoTransaction[]; total: number; page: number; limit: number; hasNext: boolean };

async function listPage(body: Record<string, unknown>, host: string, apiKey: string): Promise<Page> {
  let res: Response;
  try {
    res = await fetch(`${API}/transactions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-whitelabel-host": host,
        "x-timezone-offset": "330",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reportingCurrency: "INR", ...body }),
      cache: "no-store",
    });
  } catch {
    throw new TagMangoError("Couldn't reach TagMango — check the connection and try again", 502);
  }
  if (res.ok) return (await res.json()) as Page;

  const err = (await res.json().catch(() => null)) as { message?: string } | null;
  if (res.status === 401) throw new TagMangoError("TagMango rejected the API key — check it with your TagMango account manager", 401);
  if (res.status === 403) throw new TagMangoError(err?.message ?? "TagMango refused access for this dashboard address", 403);
  if (res.status === 404) throw new TagMangoError("TagMango couldn't find a creator for that dashboard address — check it", 404);
  if (res.status === 429) throw new TagMangoError("TagMango is limiting requests — try again in 10 seconds", 429);
  throw new TagMangoError(err?.message ?? `TagMango answered ${res.status}`, 502);
}

/** The stored credentials, when the integration is switched on and the key opens. */
export async function getTagMangoCredentials(): Promise<{ host: string; apiKey: string } | null> {
  const row = await prisma.integration.findUnique({ where: { provider: TAGMANGO_PROVIDER } });
  if (!row?.enabled || !row.keyId || !row.secretEnc) return null;
  const apiKey = openSecret(row.secretEnc);
  return apiKey ? { host: row.keyId, apiKey } : null;
}

/** What the settings card and payment form may know: never the API key. */
export async function tagMangoStatus() {
  const row = await prisma.integration.findUnique({ where: { provider: TAGMANGO_PROVIDER } });
  const keyOpens = row?.secretEnc ? openSecret(row.secretEnc) !== null : false;
  return {
    enabled: row?.enabled ?? false,
    connected: Boolean(row?.enabled && row.keyId && keyOpens),
    hasKeys: Boolean(row?.keyId && row?.secretEnc),
    // The key couldn't be decrypted — AUTH_SECRET changed since it was saved.
    needsReentry: Boolean(row?.secretEnc && !keyOpens),
    host: row?.keyId ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
  };
}

export async function isTagMangoConnected(): Promise<boolean> {
  return (await getTagMangoCredentials()) !== null;
}

/** Throws TagMangoError if the key or host don't work. Used before saving them. */
export async function testTagMangoCredentials(host: string, apiKey: string): Promise<void> {
  await listPage({ limit: 1 }, host, apiKey);
}

/**
 * Completed INR payments made between two dates (YYYY-MM-DD, IST, inclusive),
 * all pages of them, up to `max`, newest first.
 */
export async function listTagMangoPayments(fromDay: string, toDay: string, max = 2000): Promise<TagMangoPayment[]> {
  const creds = await getTagMangoCredentials();
  if (!creds) throw new TagMangoError("TagMango isn't connected — turn it on in Settings → Integrations", 409);
  const filter = {
    status: "completed",
    startDate: new Date(`${fromDay}T00:00:00+05:30`).toISOString(),
    endDate: new Date(`${toDay}T23:59:59.999+05:30`).toISOString(),
  };
  const out: TagMangoPayment[] = [];
  const seen = new Set<string>();
  for (let page = 1; out.length < max; page++) {
    const res = await listPage({ ...filter, page, limit: 100 }, creds.host, creds.apiKey);
    for (const t of res.data ?? []) {
      // Pages can overlap when transactions share a timestamp.
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const p = normalizeTagMangoTransaction(t);
      if (p.currency === "INR" && p.amount > 0) out.push(p);
    }
    if (!res.hasNext || !res.data?.length) break;
  }
  return out;
}
