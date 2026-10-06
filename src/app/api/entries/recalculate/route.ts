import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { recalculateMoneyIn } from "@/server/services/entries";

/** Brings every money-in entry onto the GST-inside-the-gross rule, and its sheet row with it. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  return NextResponse.json(await recalculateMoneyIn(admin, req));
});
