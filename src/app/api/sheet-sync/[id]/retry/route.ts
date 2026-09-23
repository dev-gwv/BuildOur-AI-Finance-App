import { NextRequest, NextResponse } from "next/server";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { retrySheetFailure } from "@/lib/sheet";

type Params = { params: Promise<{ id: string }> };

/** Re-sends one failed sheet write. Safe to repeat: writes are upserts. */
export const POST = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  const ok = await retrySheetFailure(id);
  if (!ok) throw new ApiError(502, "The sheet still didn't accept it — check the error and the script's deployment");
  return NextResponse.json({ ok: true });
});
