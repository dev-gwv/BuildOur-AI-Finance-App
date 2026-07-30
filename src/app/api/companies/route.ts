import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser, withApiErrors } from "@/lib/api-auth";
import { getAccessibleCompanyIds } from "@/lib/access";

export const GET = withApiErrors(async () => {
  const user = await requireUser();
  const accessible = await getAccessibleCompanyIds(user);

  const companies = await prisma.company.findMany({
    where: accessible === "ALL" ? {} : { id: { in: accessible } },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { expenses: true } },
    },
  });

  return NextResponse.json({ companies });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const defaultGstPercent = Number(body.defaultGstPercent ?? 18);

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const company = await prisma.company.create({
    data: { name, defaultGstPercent },
  });

  return NextResponse.json({ company }, { status: 201 });
});
