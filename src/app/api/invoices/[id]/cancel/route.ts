import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseJson } from "@/server/validation";
import { cancelInvoice, cancelSchema } from "@/server/services/creditNotes";

type Params = { params: Promise<{ id: string }> };

/** Cancel an invoice raised by mistake (JSON: reason). It keeps its number. */
export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const { reason } = await parseJson(req, cancelSchema);
  await cancelInvoice(user, id, reason, req);
  return NextResponse.json({ ok: true });
});
