import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withApiErrors } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  await prisma.payment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
