import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireAdmin, requireUser, withApiErrors } from "@/lib/api-auth";

export const GET = withApiErrors(async () => {
  await requireUser();
  const entries = await prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } });
  return NextResponse.json({ entries });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const body = await req.json();

  const amount = Number(body.amount ?? 0);
  const itemDescription = String(body.itemDescription ?? "").trim();
  const hsnSac = String(body.hsnSac ?? "").trim();

  if (!amount || !itemDescription || !hsnSac) {
    return NextResponse.json({ error: "Amount, item description, and HSN/SAC are required" }, { status: 400 });
  }

  if (await prisma.itemCatalogEntry.findUnique({ where: { amount } })) {
    throw new ApiError(400, `An item is already mapped to ₹${amount}`);
  }

  const entry = await prisma.itemCatalogEntry.create({ data: { amount, itemDescription, hsnSac } });
  return NextResponse.json({ entry }, { status: 201 });
});
