import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { removeCategory } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string; categoryId: string }> };

/** Refused while entries still use the category. */
export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id, categoryId } = await params;
  await removeCategory(admin, id, categoryId, req);
  return NextResponse.json({ ok: true });
});
