import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { enforce } from "@/server/rateLimit";
import { RazorpayError, fetchRazorpayPayment, listRecentRazorpayPayments } from "@/lib/integrations/razorpay";

/**
 * GET ?id=pay_xxx  -> that payment, with its exact fee and GST
 * GET ?recent=1    -> captured payments from the last 14 days (or ?days=N, max 60)
 * Each payment says whether it's already been recorded against an invoice,
 * so the same money can't be entered twice.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  // Each call spends the business's Razorpay API quota.
  await enforce("razorpayPerUser", user.id);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();

  try {
    const payments = id
      ? [await fetchRazorpayPayment(id)]
      : await listRecentRazorpayPayments(Math.min(60, Math.max(1, Number(searchParams.get("days") ?? 14) || 14)));

    const recorded = await prisma.payment.findMany({
      where: { gatewayRef: { in: payments.map((p) => p.id) } },
      select: { gatewayRef: true, invoice: { select: { id: true, invoiceNumber: true } } },
    });
    const byRef = new Map(recorded.map((r) => [r.gatewayRef, r.invoice]));
    const withStatus = payments.map((p) => ({ ...p, recordedOn: byRef.get(p.id) ?? null }));

    return NextResponse.json(id ? { payment: withStatus[0] } : { payments: withStatus });
  } catch (e) {
    if (e instanceof RazorpayError) throw new ApiError(e.status === 401 ? 502 : e.status, e.message);
    throw e;
  }
});
