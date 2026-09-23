import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { id, parseInput } from "@/server/validation";

const PAGE = 50;

/**
 * GET ?businessId=&entityType=&entityId=&userId=&cursor= — the audit trail,
 * newest first, 50 at a time. `nextCursor` continues it.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const sp = new URL(req.url).searchParams;
  const q = parseInput(
    z.object({
      businessId: id.optional(),
      entityType: z.string().trim().max(40).optional(),
      entityId: id.optional(),
      userId: id.optional(),
      cursor: id.optional(),
    }),
    Object.fromEntries([...sp.entries()].filter(([, v]) => v !== ""))
  );

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(q.businessId ? { businessId: q.businessId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { user: { select: { name: true, email: true } } },
  });

  const hasMore = rows.length > PAGE;
  const entries = hasMore ? rows.slice(0, PAGE) : rows;
  return NextResponse.json({ entries, nextCursor: hasMore ? entries[entries.length - 1].id : null });
});
