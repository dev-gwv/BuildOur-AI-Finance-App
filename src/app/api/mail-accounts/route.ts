import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { listMailAccounts } from "@/server/mailAccounts";
import { createMailbox, createMailboxSchema } from "@/server/services/mailboxes";

/** The saved mailboxes — never their passwords. */
export const GET = withApiErrors(async () => {
  await requireAdmin();
  return NextResponse.json({ mailboxes: await listMailAccounts() });
});

/** Adds a mailbox after a successful test sign-in. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  const input = await parseJson(req, createMailboxSchema);
  return NextResponse.json({ mailbox: await createMailbox(admin, input, req) }, { status: 201 });
});
