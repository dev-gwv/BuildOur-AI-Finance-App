import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { parseJson } from "@/server/validation";
import { setIntegrationMode } from "@/server/services/gatewayImport";
import type { ImportProvider } from "@/lib/gatewayImport";

type Params = { params: Promise<{ provider: string }> };

/** PUT { mode: "api" | "file" } — how this gateway's payments come in. */
export const PUT = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin();
  const { provider } = await params;
  if (provider !== "razorpay" && provider !== "tagmango") throw badRequest("Unknown gateway");
  const { mode } = await parseJson(req, z.object({ mode: z.enum(["api", "file"]) }));
  await setIntegrationMode(admin, provider as ImportProvider, mode, req);
  return NextResponse.json({ ok: true });
});
