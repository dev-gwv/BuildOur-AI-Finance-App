import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireAdmin, requireUser, withApiErrors } from "@/lib/api-auth";
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
  await requireAdmin();
  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Expected a form submission");

  const brand = String(form.get("brand") ?? "");
  if (brand !== "GRATEFUL" && brand !== "MULBERRY") {
    throw new ApiError(400, "Unknown brand");
  }

  // Resetting to the built-in wording is just clearing the saved row.
  if (form.get("reset") === "true") {
    await prisma.emailTemplate.deleteMany({ where: { brand } });
    return NextResponse.json({ template: { brand, ...DEFAULT_TEMPLATES[brand], isDefault: true } });
  }

  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!subject || !body) throw new ApiError(400, "Both a subject and a message are required");

  const template = await prisma.emailTemplate.upsert({
    where: { brand },
    create: { brand, subject, body },
    update: { subject, body },
  });

  return NextResponse.json({ template: { ...template, isDefault: false } });
});
