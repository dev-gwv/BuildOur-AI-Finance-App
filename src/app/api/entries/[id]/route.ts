import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { badRequest } from "@/server/errors";
import { formToObject, parseInput } from "@/server/validation";
import { prisma } from "@/lib/prisma";
import { deleteEntry, entrySchema, getEntry, updateEntry } from "@/server/services/entries";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return NextResponse.json({ entry: await getEntry(user, id) });
});

/**
 * Edit (same form as create). Fields left out keep their current value for the
 * business; a new `screenshot` replaces the stored proof. Access is checked in
 * updateEntry against both the current and any new business.
 */
export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected a form submission");
  if (!form.get("businessId")) {
    const current = await prisma.expense.findUnique({ where: { id }, select: { businessId: true } });
    if (current) form.set("businessId", current.businessId);
  }
  const data = parseInput(entrySchema, formToObject(form));
  const { entry, warning } = await updateEntry(user, id, data, form, req);
  return NextResponse.json({ entry, warning });
});

export const DELETE = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await deleteEntry(user, id, req);
  return NextResponse.json({ ok: true });
});
