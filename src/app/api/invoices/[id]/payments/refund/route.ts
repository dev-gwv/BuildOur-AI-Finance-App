import { NextRequest, NextResponse } from "next/server";
import { badRequest, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { recordRefund } from "@/server/services/payments";

type Params = { params: Promise<{ id: string }> };

/** Records a refund to the customer (form: amount, paidOn, method, note) once a credit note has left the invoice overpaid. */
export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected a form submission");
  const { payment } = await recordRefund(user, id, form, req);
  return NextResponse.json({ payment }, { status: 201 });
});
