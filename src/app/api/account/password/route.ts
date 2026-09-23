import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { enforce } from "@/server/rateLimit";
import { parseJson } from "@/server/validation";
import { changeOwnPassword, changePasswordSchema } from "@/server/services/users";

/**
 * `{ currentPassword, newPassword }`. Ends every session of this account,
 * this one included, so the client should send the user to sign in again.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  // Guessing the current password through this form counts like a login attempt.
  await enforce("loginPerEmail", `pw:${user.id}`);
  const input = await parseJson(req, changePasswordSchema);
  await changeOwnPassword(user, input, req);
  return NextResponse.json({ ok: true, signedOut: true });
});
