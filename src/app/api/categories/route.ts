import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, withApiErrors } from "@/lib/api-auth";

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const body = await req.json();
  const companyId = String(body.companyId ?? "");
  const name = String(body.name ?? "").trim();

  if (!companyId || !name) {
    return NextResponse.json(
      { error: "companyId and name are required" },
      { status: 400 }
    );
  }

  const category = await prisma.category.create({
    data: { companyId, name },
  });

  return NextResponse.json({ category }, { status: 201 });
});
