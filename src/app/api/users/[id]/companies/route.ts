import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, withApiErrors } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  const body = await req.json();
  const companyId = String(body.companyId ?? "");

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  await prisma.companyMember.upsert({
    where: { userId_companyId: { userId: id, companyId } },
    create: { userId: id, companyId },
    update: {},
  });

  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  const companyId = new URL(req.url).searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  await prisma.companyMember.deleteMany({ where: { userId: id, companyId } });
  return NextResponse.json({ ok: true });
});
