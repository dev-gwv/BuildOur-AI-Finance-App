import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseForm } from "@/server/validation";
import { createInvoice, createInvoiceSchema, listInvoices } from "@/server/services/invoices";

/** GET ?businessId= — invoices the user can access, newest first. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const businessId = new URL(req.url).searchParams.get("businessId");
  return NextResponse.json({ invoices: await listInvoices(user, businessId) });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const { data, form } = await parseForm(req, createInvoiceSchema);
  const { invoice, warning } = await createInvoice(user, data, form, req);
  return NextResponse.json({ invoice, ...(warning ? { warning } : {}) }, { status: 201 });
});
