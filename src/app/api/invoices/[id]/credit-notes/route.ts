import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseJson } from "@/server/validation";
import { createCreditNote, creditNoteSchema } from "@/server/services/creditNotes";

type Params = { params: Promise<{ id: string }> };

/** Issue a credit note against an invoice (JSON: noteDate, reason, grossAmount, gstPercent?). */
export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const input = await parseJson(req, creditNoteSchema);
  return NextResponse.json({ creditNote: await createCreditNote(user, id, input, req) }, { status: 201 });
});
