import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { membersSchema, setMembers } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string }> };

/** Replaces the business's team (non-admins who can see it) with `userIds`. */
export const PUT = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { userIds } = await parseJson(req, membersSchema);
  await setMembers(admin, id, userIds, req);
  return NextResponse.json({ ok: true });
});
