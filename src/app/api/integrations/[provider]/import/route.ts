import { NextRequest, NextResponse } from "next/server";
import { badRequest, withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseForm } from "@/server/validation";
import { importGatewayReport, importOptionsSchema } from "@/server/services/gatewayImport";
import type { ImportProvider } from "@/lib/gatewayImport";

type Params = { params: Promise<{ provider: string }> };

/**
 * POST multipart: file (CSV / .xlsx), mapping?, inPaise?, commit?
 * Without commit: a preview of what the report holds. With it: saves them.
 */
export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { provider } = await params;
  if (provider !== "razorpay" && provider !== "tagmango") throw badRequest("Unknown gateway");
  const { data, form } = await parseForm(req, importOptionsSchema);
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose the exported report to upload");
  return NextResponse.json(await importGatewayReport(admin, provider as ImportProvider, file, data, req));
});
