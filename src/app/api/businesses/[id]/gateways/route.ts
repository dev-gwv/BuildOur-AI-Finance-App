import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { addGateway, gatewaySchema } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const input = await parseJson(req, gatewaySchema);
  return NextResponse.json({ gateway: await addGateway(admin, id, input, req) }, { status: 201 });
});
