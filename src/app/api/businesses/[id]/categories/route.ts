import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { addCategory, categorySchema } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { name } = await parseJson(req, categorySchema);
  return NextResponse.json({ category: await addCategory(admin, id, name, req) }, { status: 201 });
});
