import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/validation";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { audit } from "@/server/audit";
import { guardWrite } from "@/server/services/common";
import { sealSecret, openSecret } from "@/lib/secretBox";
import { RAZORPAY_PROVIDER, RazorpayError, maskKeyId, testRazorpayCredentials } from "@/lib/integrations/razorpay";

async function status() {
  const row = await prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER } });
  const secretOpens = row?.secretEnc ? openSecret(row.secretEnc) !== null : false;
  return {
    enabled: row?.enabled ?? false,
    connected: Boolean(row?.enabled && row.keyId && secretOpens),
    hasKeys: Boolean(row?.keyId && row?.secretEnc),
    // The secret couldn't be decrypted — AUTH_SECRET changed since it was saved.
    needsReentry: Boolean(row?.secretEnc && !secretOpens),
    keyId: maskKeyId(row?.keyId ?? null),
    mode: row?.keyId?.startsWith("rzp_test_") ? "test" : row?.keyId ? "live" : null,
    connectedAt: row?.connectedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

/** Whether Razorpay is connected. Never returns the secret. */
export const GET = withApiErrors(async () => {
  await requireUser();
  return NextResponse.json(await status());
});

/**
 * Save keys and/or switch the integration on or off. New keys are checked
 * against Razorpay before they're stored, so a typo can't be saved as "connected".
 */
const putSchema = z.object({
  enabled: z.boolean().optional(),
  keyId: z.string().trim().max(100).optional(),
  keySecret: z.string().trim().max(200).optional(),
});

export const PUT = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  const body = await parseJson(req, putSchema);

  const existing = await prisma.integration.findUnique({ where: { provider: RAZORPAY_PROVIDER } });
  const keyId = body.keyId?.trim() || existing?.keyId || null;
  const keySecret = body.keySecret?.trim() || null;
  const enabled = body.enabled ?? existing?.enabled ?? false;

  if (keyId && !/^rzp_(live|test)_[A-Za-z0-9]+$/.test(keyId)) {
    throw new ApiError(400, "The Key ID starts with rzp_live_ or rzp_test_");
  }

  let secretEnc = existing?.secretEnc ?? null;
  let connectedAt = existing?.connectedAt ?? null;
  if (keySecret) {
    if (!keyId) throw new ApiError(400, "Enter the Key ID too");
    try {
      await testRazorpayCredentials(keyId, keySecret);
    } catch (e) {
      throw new ApiError(400, e instanceof RazorpayError ? e.message : "Couldn't verify those keys with Razorpay");
    }
    secretEnc = sealSecret(keySecret);
    connectedAt = new Date();
  } else if (body.keyId && body.keyId.trim() !== existing?.keyId) {
    throw new ApiError(400, "Enter the Key Secret that goes with the new Key ID");
  }

  if (enabled && (!keyId || !secretEnc)) throw new ApiError(400, "Add the Razorpay Key ID and Key Secret before turning this on");

  await prisma.integration.upsert({
    where: { provider: RAZORPAY_PROVIDER },
    create: { provider: RAZORPAY_PROVIDER, enabled, keyId, secretEnc, connectedAt, lastError: null },
    update: { enabled, keyId, secretEnc, connectedAt, lastError: null },
  });
  await audit({
    user: admin,
    action: "integration.razorpay",
    entityType: "integration",
    entityId: RAZORPAY_PROVIDER,
    summary: [keySecret ? `Razorpay keys set (${maskKeyId(keyId)})` : null, existing?.enabled !== enabled ? (enabled ? "switched on" : "switched off") : null]
      .filter(Boolean)
      .join(", ") || "Razorpay settings saved",
    req,
  });
  return NextResponse.json(await status());
});

/** Disconnect: forget the keys entirely. */
export const DELETE = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  await prisma.integration.deleteMany({ where: { provider: RAZORPAY_PROVIDER } });
  await audit({ user: admin, action: "integration.razorpay", entityType: "integration", entityId: RAZORPAY_PROVIDER, summary: "Razorpay disconnected (keys deleted)", req });
  return NextResponse.json(await status());
});
