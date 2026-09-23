import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { deleteCreditNote } from "@/server/services/creditNotes";

type Params = { params: Promise<{ id: string }> };

/** Admins only, and only outside a filed GST period. */
export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await deleteCreditNote(user, id, req);
  return NextResponse.json({ ok: true });
});
