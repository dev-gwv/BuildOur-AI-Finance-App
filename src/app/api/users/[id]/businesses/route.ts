import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { setUserBusinesses, userBusinessesSchema } from "@/server/services/users";

type Params = { params: Promise<{ id: string }> };

/** Replaces which businesses a member can see. Admins see all regardless. */
export const PUT = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { businessIds } = await parseJson(req, userBusinessesSchema);
  await setUserBusinesses(admin, id, businessIds, req);
  return NextResponse.json({ ok: true });
});
