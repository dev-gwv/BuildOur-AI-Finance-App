import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { deleteUpload } from "@/lib/storage";
import { syncPaymentToSheet } from "@/lib/sheet";

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
  // A payment removed here must not stay in the sheet, or its month stops
  // adding up. Sent for every payment: an id the sheet never had is a no-op.
  after(() => syncPaymentToSheet({ action: "remove", id }));

  return NextResponse.json({ ok: true });
});
