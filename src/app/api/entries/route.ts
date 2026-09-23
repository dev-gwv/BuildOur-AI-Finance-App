import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseForm, parseInput } from "@/server/validation";
import { createEntry, entryFilterSchema, entrySchema, listEntries } from "@/server/services/entries";

/** GET ?businessId=&direction=IN|OUT&from=&to=&q= — money in/out the user can access. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const filters = parseInput(entryFilterSchema, {
    businessId: sp.get("businessId") || undefined,
    direction: sp.get("direction") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    q: sp.get("q") || undefined,
  });
  return NextResponse.json({ entries: await listEntries(user, filters) });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const { data, form } = await parseForm(req, entrySchema);
  return NextResponse.json({ entry: await createEntry(user, data, form, req) }, { status: 201 });
});
