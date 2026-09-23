import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { audit } from "@/server/audit";
import { guardWrite } from "@/server/services/common";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  await guardWrite(admin);
  const { id } = await params;
  const entry = await prisma.itemCatalogEntry.findUnique({ where: { id } });
  if (!entry) throw notFound("That catalog item");
  await prisma.itemCatalogEntry.delete({ where: { id } });
  await audit({
    user: admin,
    action: "catalog.delete",
    entityType: "catalog",
    entityId: id,
    summary: `Catalog: removed ₹${entry.amount.toLocaleString("en-IN")} → ${entry.itemDescription}`,
    req,
  });
  return NextResponse.json({ ok: true });
});
