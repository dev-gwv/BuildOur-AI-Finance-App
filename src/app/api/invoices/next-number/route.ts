import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { id, parseInput } from "@/server/validation";
import { nextInvoiceNumber } from "@/server/services/invoices";

/** GET ?businessId= — what the next invoice will be numbered. A preview; nothing is reserved. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const { businessId } = parseInput(z.object({ businessId: id }), {
    businessId: new URL(req.url).searchParams.get("businessId") ?? undefined,
  });
  return NextResponse.json({ number: await nextInvoiceNumber(user, businessId) });
});
