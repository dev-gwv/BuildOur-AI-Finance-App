import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { deleteUpload } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) throw new ApiError(404, "Payment not found");

  await prisma.payment.delete({ where: { id } });
  // The screenshot is stored outside the database, so dropping the row alone
  // would leave it billed and unreachable forever — same cleanup expenses do.
  if (payment.proofPath) {
    await deleteUpload(payment.proofPath).catch(() => {});
  }
  return NextResponse.json({ ok: true });
});
