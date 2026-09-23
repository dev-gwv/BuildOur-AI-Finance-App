import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { deleteUser, updateUser, updateUserSchema } from "@/server/services/users";

type Params = { params: Promise<{ id: string }> };

/** `{ name?, role?, active?, password? }` — role, active or password changes end that user's sessions. */
export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const input = await parseJson(req, updateUserSchema);
  return NextResponse.json({ user: await updateUser(admin, id, input, req) });
});

/** Only for accounts that created nothing; otherwise deactivate them. */
export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  await deleteUser(admin, id, req);
  return NextResponse.json({ ok: true });
});
