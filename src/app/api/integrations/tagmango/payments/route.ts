import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { enforce } from "@/server/rateLimit";
import { shiftDay } from "@/lib/integrations/razorpay";
import { TagMangoError, listTagMangoPayments, tagMangoSource } from "@/lib/integrations/tagmango";
import { newestStoredPayment } from "@/lib/integrations/storedPayments";

/**
 * GET ?recent=1&days=N -> every completed TagMango payment from the last N
 * days (default 14, max 60), newest first, each saying whether it's already
 * been recorded against an invoice.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  // Each call spends the account's TagMango API quota.
  await enforce("tagmangoPerUser", user.id);
  const { searchParams } = new URL(req.url);
  const days = Math.min(60, Math.max(1, Number(searchParams.get("days") ?? 14) || 14));
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  try {
    const payments = (await listTagMangoPayments(shiftDay(today, -(days - 1)), today)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const recorded = await prisma.payment.findMany({
      where: { gatewayRef: { in: payments.map((p) => p.id) } },
      select: { gatewayRef: true, invoice: { select: { id: true, invoiceNumber: true } } },
    });
    const byRef = new Map(recorded.map((r) => [r.gatewayRef, r.invoice]));
    const source = await tagMangoSource();
    return NextResponse.json({
      payments: payments.map((p) => ({ ...p, recordedOn: byRef.get(p.id) ?? null })),
      source,
      newest: source === "file" ? await newestStoredPayment("tagmango") : null,
    });
  } catch (e) {
    if (e instanceof TagMangoError) throw new ApiError(e.status === 401 ? 502 : e.status, e.message);
    throw e;
  }
});
