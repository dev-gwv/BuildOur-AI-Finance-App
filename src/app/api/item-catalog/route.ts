import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { conflict, withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { audit } from "@/server/audit";
import { parseJson, positiveMoney, requiredText } from "@/server/validation";
import { guardWrite } from "@/server/services/common";

export const GET = withApiErrors(async () => {
  await requireUser();
  const entries = await prisma.itemCatalogEntry.findMany({ orderBy: { amount: "asc" } });
  return NextResponse.json({ entries });
});

/** Maps a DO's exact loan amount to the product it pays for (Bajaj DOs never name it). */
export const POST = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  const input = await parseJson(
    req,
    z.object({
      amount: positiveMoney("Amount"),
      itemDescription: requiredText("Item description", 300),
      hsnSac: requiredText("HSN/SAC", 20),
    })
  );

  if (await prisma.itemCatalogEntry.findUnique({ where: { amount: input.amount } })) {
    throw conflict(`An item is already mapped to ₹${input.amount.toLocaleString("en-IN")}`);
  }

  const entry = await prisma.itemCatalogEntry.create({ data: input });
  await audit({
    user: admin,
    action: "catalog.create",
    entityType: "catalog",
    entityId: entry.id,
    summary: `Catalog: ₹${entry.amount.toLocaleString("en-IN")} → ${entry.itemDescription}`,
    req,
  });
  return NextResponse.json({ entry }, { status: 201 });
});
