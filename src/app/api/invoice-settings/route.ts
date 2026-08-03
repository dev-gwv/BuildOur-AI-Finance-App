import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser, withApiErrors } from "@/lib/api-auth";

const SETTINGS_ID = "default";

export const GET = withApiErrors(async () => {
  await requireUser();
  const settings = await prisma.invoiceSettings.findUnique({ where: { id: SETTINGS_ID } });
  return NextResponse.json({ settings: settings ?? { terms: null, notes: null } });
});

export const PATCH = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const body = await req.json();

  const terms = body.terms ? String(body.terms) : null;
  const notes = body.notes ? String(body.notes) : null;

  const settings = await prisma.invoiceSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, terms, notes },
    update: { terms, notes },
  });

  return NextResponse.json({ settings });
});
