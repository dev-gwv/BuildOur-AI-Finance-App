import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/validation";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { audit } from "@/server/audit";
import { guardWrite } from "@/server/services/common";
import { sealSecret } from "@/lib/secretBox";
import { TAGMANGO_PROVIDER, TagMangoError, tagMangoStatus, testTagMangoCredentials } from "@/lib/integrations/tagmango";
import { normalizeTagMangoHost } from "@/lib/integrations/tagmangoPayment";

/** Whether TagMango is connected. Never returns the key. */
export const GET = withApiErrors(async () => {
  await requireUser();
  return NextResponse.json(await tagMangoStatus());
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  /** The TagMango dashboard's address, e.g. learn.example.com. */
  host: z.string().trim().max(253).optional(),
  apiKey: z.string().trim().max(4000).optional(),
});

/**
 * Save the dashboard address and API key and/or switch the integration on or
 * off. A new key is checked against TagMango before it's stored.
 */
export const PUT = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  const body = await parseJson(req, putSchema);

  const existing = await prisma.integration.findUnique({ where: { provider: TAGMANGO_PROVIDER } });
  let host = existing?.keyId ?? null;
  if (body.host !== undefined && body.host !== "") {
    host = normalizeTagMangoHost(body.host);
    if (!host) throw new ApiError(400, "Enter the dashboard address, like learn.yourbrand.com", { host: "A web address like learn.yourbrand.com" });
  }
  const apiKey = body.apiKey?.trim() || null;
  const enabled = body.enabled ?? existing?.enabled ?? false;

  let secretEnc = existing?.secretEnc ?? null;
  let connectedAt = existing?.connectedAt ?? null;
  if (apiKey) {
    if (!host) throw new ApiError(400, "Enter the dashboard address too", { host: "Required" });
    try {
      await testTagMangoCredentials(host, apiKey);
    } catch (e) {
      throw new ApiError(400, e instanceof TagMangoError ? e.message : "Couldn't verify that key with TagMango", { apiKey: "Not accepted" });
    }
    secretEnc = sealSecret(apiKey);
    connectedAt = new Date();
  } else if (host !== (existing?.keyId ?? null)) {
    throw new ApiError(400, "Paste the API key again with the new dashboard address", { apiKey: "Required" });
  }

  if (enabled && (!host || !secretEnc)) throw new ApiError(400, "Add the dashboard address and API key before turning this on");

  await prisma.integration.upsert({
    where: { provider: TAGMANGO_PROVIDER },
    create: { provider: TAGMANGO_PROVIDER, enabled, keyId: host, secretEnc, connectedAt, lastError: null },
    update: { enabled, keyId: host, secretEnc, connectedAt, lastError: null },
  });
  await audit({
    user: admin,
    action: "integration.tagmango",
    entityType: "integration",
    entityId: TAGMANGO_PROVIDER,
    summary:
      [apiKey ? `TagMango connected (${host})` : null, existing?.enabled !== enabled ? (enabled ? "switched on" : "switched off") : null]
        .filter(Boolean)
        .join(", ") || "TagMango settings saved",
    req,
  });
  return NextResponse.json(await tagMangoStatus());
});

/** Disconnect: forget the key entirely. */
export const DELETE = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  await prisma.integration.deleteMany({ where: { provider: TAGMANGO_PROVIDER } });
  await audit({ user: admin, action: "integration.tagmango", entityType: "integration", entityId: TAGMANGO_PROVIDER, summary: "TagMango disconnected (key deleted)", req });
  return NextResponse.json(await tagMangoStatus());
});
