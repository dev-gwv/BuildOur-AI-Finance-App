import { NextRequest, NextResponse } from "next/server";
import { badRequest, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { recordPayment } from "@/server/services/payments";

type Params = { params: Promise<{ id: string }> };

/** Records money received against an invoice (form: amount, paidOn, method, note, gateway fields, proof). */
export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected a form submission");
  const { payment, warning } = await recordPayment(user, id, form, req);
  return NextResponse.json({ payment, ...(warning ? { warning } : {}) }, { status: 201 });
});
