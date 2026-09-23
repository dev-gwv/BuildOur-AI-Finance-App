import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { audit } from "@/server/audit";
import { guardWrite } from "@/server/services/common";

const SETTINGS_ID = "default";

// Kept small deliberately: the signature is inlined into every invoice page as
// a data URI, so a heavy image would bloat each render.
const MAX_SIGNATURE_BYTES = 500 * 1024;
const ALLOWED_SIGNATURE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const GET = withApiErrors(async () => {
  await requireUser();
  const settings = await prisma.invoiceSettings.findUnique({ where: { id: SETTINGS_ID } });
  return NextResponse.json({
    settings: settings ?? {
      terms: null,
      notes: null,
      signatureDataUri: null,
      razorpayFeePercent: 2,
      razorpayFeeGstPercent: 18,
    },
  });
});

export const PATCH = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Expected a form submission");

  const terms = form.get("terms") ? String(form.get("terms")).slice(0, 5000) : null;
  const notes = form.get("notes") ? String(form.get("notes")).slice(0, 2000) : null;
  const signature = form.get("signature");
  const removeSignature = form.get("removeSignature") === "true";

  // Absent means unchanged, so older forms can't reset the rates by accident.
  const readPercent = (name: string, label: string): number | undefined => {
    const raw = form.get(name);
    if (raw === null || String(raw).trim() === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, `${label} must be between 0 and 100`);
    return n;
  };
  const razorpayFeePercent = readPercent("razorpayFeePercent", "Razorpay commission");
  const razorpayFeeGstPercent = readPercent("razorpayFeeGstPercent", "GST on the Razorpay commission");
  const rates = {
    ...(razorpayFeePercent !== undefined ? { razorpayFeePercent } : {}),
    ...(razorpayFeeGstPercent !== undefined ? { razorpayFeeGstPercent } : {}),
  };

  // Left undefined so an ordinary save of terms/notes doesn't disturb the
  // stored signature; only an explicit upload or removal touches it.
  let signatureDataUri: string | null | undefined;

  if (removeSignature) {
    signatureDataUri = null;
  } else if (signature instanceof File && signature.size > 0) {
    if (!ALLOWED_SIGNATURE_TYPES.includes(signature.type)) {
      throw new ApiError(400, "Signature must be a PNG, JPG, or WebP image");
    }
    if (signature.size > MAX_SIGNATURE_BYTES) {
      throw new ApiError(400, "Signature image must be under 500 KB");
    }
    const base64 = Buffer.from(await signature.arrayBuffer()).toString("base64");
    signatureDataUri = `data:${signature.type};base64,${base64}`;
  }

  const settings = await prisma.invoiceSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, terms, notes, signatureDataUri: signatureDataUri ?? null, ...rates },
    update: { terms, notes, ...rates, ...(signatureDataUri !== undefined ? { signatureDataUri } : {}) },
  });

  await audit({
    user: admin,
    action: "settings.invoicing",
    entityType: "settings",
    entityId: SETTINGS_ID,
    summary: [
      "Updated invoice defaults",
      signatureDataUri === null ? "signature removed" : signatureDataUri ? "new signature" : null,
      razorpayFeePercent !== undefined ? `Razorpay ${razorpayFeePercent}%` : null,
      razorpayFeeGstPercent !== undefined ? `GST on fee ${razorpayFeeGstPercent}%` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    req,
  });

  return NextResponse.json({ settings });
});
