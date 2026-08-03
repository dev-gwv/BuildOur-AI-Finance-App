import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withApiErrors } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ invoice });
});

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  await prisma.invoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
