import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { parseForm } from "@/server/validation";
import { deleteEntry, entrySchema, getEntry, updateEntry } from "@/server/services/entries";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return NextResponse.json({ entry: await getEntry(user, id) });
});

/** Full edit (same form as create). A new `screenshot` replaces the stored proof. */
export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const { data, form } = await parseForm(req, entrySchema);
  return NextResponse.json({ entry: await updateEntry(user, id, data, form, req) });
});

export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await deleteEntry(user, id, req);
  return NextResponse.json({ ok: true });
});
