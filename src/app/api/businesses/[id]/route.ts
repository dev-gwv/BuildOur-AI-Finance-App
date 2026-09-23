import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { parseJson } from "@/server/validation";
import { getBusinessDetail, updateBusiness, updateBusinessSchema } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string }> };

/** Settings, categories, gateways and members — never the sheet secret. */
export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return NextResponse.json({ business: await getBusinessDetail(user, id) });
});

/** Businesses are archived (`archived: true`), never deleted: invoices point at them. */
export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const input = await parseJson(req, updateBusinessSchema);
  return NextResponse.json({ business: await updateBusiness(admin, id, input, req) });
});
