import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireAdmin, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany } from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  if (!(await canAccessCompany(user, id))) {
    throw new ApiError(403, "No access to this company");
  }

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      gateways: { orderBy: { name: "asc" } },
      categories: { orderBy: { name: "asc" } },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ company });
});

export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  const body = await req.json();

  const data: { name?: string; defaultGstPercent?: number } = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.defaultGstPercent !== undefined)
    data.defaultGstPercent = Number(body.defaultGstPercent);

  const company = await prisma.company.update({ where: { id }, data });
  return NextResponse.json({ company });
});

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  await prisma.company.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
