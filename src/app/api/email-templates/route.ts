import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { audit } from "@/server/audit";
import { guardWrite } from "@/server/services/common";
import { DEFAULT_TEMPLATES } from "@/lib/emailTemplate";
import type { BrandKey } from "@/lib/brands";

export const GET = withApiErrors(async () => {
  await requireUser();
  const saved = await prisma.emailTemplate.findMany();
  const templates = (["GRATEFUL", "MULBERRY"] as BrandKey[]).map((brand) => {
    const row = saved.find((t) => t.brand === brand);
    return { brand, ...(row ?? DEFAULT_TEMPLATES[brand]), isDefault: !row };
  });
  return NextResponse.json({ templates });
});

export const PATCH = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Expected a form submission");

  const brand = String(form.get("brand") ?? "");
  if (brand !== "GRATEFUL" && brand !== "MULBERRY") {
    throw new ApiError(400, "Unknown brand");
  }

  // Resetting to the built-in wording is just clearing the saved row.
  if (form.get("reset") === "true") {
    await prisma.emailTemplate.deleteMany({ where: { brand } });
    await audit({ user: admin, action: "settings.email", entityType: "emailTemplate", entityId: brand, summary: `Reset the ${brand.toLowerCase()} email to the default wording`, req });
    return NextResponse.json({ template: { brand, ...DEFAULT_TEMPLATES[brand], isDefault: true } });
  }

  const subject = String(form.get("subject") ?? "").trim().replace(/[\r\n]+/g, " ").slice(0, 300);
  const body = String(form.get("body") ?? "").trim().slice(0, 20_000);
  if (!subject || !body) throw new ApiError(400, "Both a subject and a message are required");

  const template = await prisma.emailTemplate.upsert({
    where: { brand },
    create: { brand, subject, body },
    update: { subject, body },
  });
  await audit({ user: admin, action: "settings.email", entityType: "emailTemplate", entityId: brand, summary: `Edited the ${brand.toLowerCase()} invoice email`, req });

  return NextResponse.json({ template: { ...template, isDefault: false } });
});
