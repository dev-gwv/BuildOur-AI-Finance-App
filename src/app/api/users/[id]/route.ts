import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, withApiErrors } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
