import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { testBusinessSheet } from "@/server/services/businesses";

type Params = { params: Promise<{ id: string }> };

/** Checks the business's sheet answers: `{ ok, workbook?, error? }`. */
export const POST = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireAdmin();
  const { id } = await params;
  return NextResponse.json(await testBusinessSheet(id));
});
