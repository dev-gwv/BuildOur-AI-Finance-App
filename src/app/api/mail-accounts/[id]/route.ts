import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { deleteMailbox, updateMailbox, updateMailboxSchema } from "@/server/services/mailboxes";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const input = await parseJson(req, updateMailboxSchema);
  return NextResponse.json({ mailbox: await updateMailbox(admin, id, input, req) });
});

/** Businesses that sent from it fall back to the default mailbox. */
export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  await deleteMailbox(admin, id, req);
  return NextResponse.json({ ok: true });
});
