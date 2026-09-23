import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseJson } from "@/server/validation";
import { deleteInvoice, getInvoice, updateInvoice, updateInvoiceSchema } from "@/server/services/invoices";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return NextResponse.json({ invoice: await getInvoice(user, id) });
});

/** Edit (JSON). `businessId` moves it to another business of the same entity (admins). */
export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const input = await parseJson(req, updateInvoiceSchema);
  return NextResponse.json({ invoice: await updateInvoice(user, id, input, req) });
});

/** Admins only. Its payments, their sheet rows and stored files go with it. */
export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await deleteInvoice(user, id, req);
  return NextResponse.json({ ok: true });
});
