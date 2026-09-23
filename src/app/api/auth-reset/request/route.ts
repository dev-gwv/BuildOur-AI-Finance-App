import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiErrors } from "@/server/errors";
import { parseJson } from "@/server/validation";
import { requestPasswordReset } from "@/server/passwordReset";

/**
 * POST { email } — emails a one-time reset link if the address has an active
 * account. Always answers the same, so it can't reveal who has an account.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const { email } = await parseJson(req, z.object({ email: z.string().trim().max(200) }));
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) await requestPasswordReset(email, req);
  return NextResponse.json({
    ok: true,
    message: "If that email has an account, a reset link is on its way. It works for 30 minutes.",
  });
});
