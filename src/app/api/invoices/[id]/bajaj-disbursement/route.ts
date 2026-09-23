import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseJson } from "@/server/validation";
import { bajajDisbursementSchema, recordBajajDisbursement } from "@/server/services/payments";

type Params = { params: Promise<{ id: string }> };

/** Records Bajaj Finance's payout on a financed sale: JSON { credited, paidOn, reference? }. */
export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const input = await parseJson(req, bajajDisbursementSchema);
  const { payment } = await recordBajajDisbursement(user, id, input, req);
  return NextResponse.json({ payment }, { status: 201 });
});
