import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiErrors } from "@/server/errors";
import { parseJson, password } from "@/server/validation";
import { completePasswordReset } from "@/server/passwordReset";

/** POST { token, password } — sets a new password from an emailed link and signs out every session. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const input = await parseJson(req, z.object({ token: z.string().min(20).max(200), password }));
  await completePasswordReset(input.token, input.password, req);
  return NextResponse.json({ ok: true });
});
