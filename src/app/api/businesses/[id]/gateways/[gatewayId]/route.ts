import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { gatewayUpdateSchema, removeGateway, updateGateway } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string; gatewayId: string }> };

/** Changes apply to new entries; saved ones keep the charge they were recorded with. */
export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id, gatewayId } = await params;
  const input = await parseJson(req, gatewayUpdateSchema);
  return NextResponse.json({ gateway: await updateGateway(admin, id, gatewayId, input, req) });
});

/** Refused while entries were received through it. */
export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { id, gatewayId } = await params;
  await removeGateway(admin, id, gatewayId, req);
  return NextResponse.json({ ok: true });
});
