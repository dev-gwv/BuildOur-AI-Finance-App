import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { retrySheetFailure } from "@/lib/sheet";

/**
 * Re-sends every pending failed write, oldest first, so a record's writes land
 * in the order they happened. Capped so one request can't run away.
 */
export const POST = withApiErrors(async () => {
  await requireAdmin();
  const pending = await prisma.sheetSyncFailure.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true },
  });
  let fixed = 0;
  for (const f of pending) {
    if (await retrySheetFailure(f.id)) fixed++;
  }
  return NextResponse.json({ ok: true, attempted: pending.length, fixed });
});
