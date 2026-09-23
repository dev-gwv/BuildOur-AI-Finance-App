import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { createUser, createUserSchema, listUsers } from "@/server/services/users";

export const GET = withApiErrors(async () => {
  await requireAdmin();
  return NextResponse.json({ users: await listUsers() });
});

/** `{ name, email, password, role, businessIds? }` — email is stored lowercased. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  const input = await parseJson(req, createUserSchema);
  return NextResponse.json({ user: await createUser(admin, input, req) }, { status: 201 });
});
