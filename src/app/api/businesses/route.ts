import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin, requireUser } from "@/server/session";
import { parseJson } from "@/server/validation";
import { createBusiness, createBusinessSchema, listBusinesses } from "@/server/services/businesses";

/** Businesses the user can access (admins also see archived ones). */
export const GET = withApiErrors(async () => {
  const user = await requireUser();
  return NextResponse.json({ businesses: await listBusinesses(user) });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  const input = await parseJson(req, createBusinessSchema);
  return NextResponse.json({ business: await createBusiness(admin, input, req) }, { status: 201 });
});
