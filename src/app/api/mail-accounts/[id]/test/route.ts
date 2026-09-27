import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { testMailbox } from "@/server/services/mailboxes";

type Params = { params: Promise<{ id: string }> };

/** Signs in to the mailbox again (nothing is sent). */
export const POST = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  return NextResponse.json(await testMailbox(id));
});
