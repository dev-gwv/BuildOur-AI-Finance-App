import { NextRequest, NextResponse } from "next/server";
import { badRequest, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { deletePayment, updatePayment } from "@/server/services/payments";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected a form submission");
  return NextResponse.json({ payment: await updatePayment(user, id, form, req) });
});

export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await deletePayment(user, id, req);
  return NextResponse.json({ ok: true });
});
