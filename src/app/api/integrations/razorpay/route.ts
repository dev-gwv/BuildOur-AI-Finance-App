import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireAdmin, requireUser, withApiErrors } from "@/lib/api-auth";
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
export const PUT = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const body = (await req.json().catch(() => null)) as { enabled?: boolean; keyId?: string; keySecret?: string } | null;
  if (!body) throw new ApiError(400, "Expected JSON");

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
  return NextResponse.json(await status());
});

/** Disconnect: forget the keys entirely. */
export const DELETE = withApiErrors(async () => {
  await requireAdmin();
  await prisma.integration.deleteMany({ where: { provider: RAZORPAY_PROVIDER } });
  return NextResponse.json(await status());
});
