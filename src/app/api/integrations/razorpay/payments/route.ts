import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { enforce } from "@/server/rateLimit";
import {
  RazorpayError,
  fetchRazorpayPayment,
  listRazorpayPaymentsBetween,
  listRecentRazorpayPayments,
  matchRazorpayPayment,
  shiftDay,
} from "@/lib/integrations/razorpay";

/**
 * GET ?id=pay_xxx                 -> that payment, with its exact fee and GST
 * GET ?recent=1                   -> captured payments from the last 14 days (or ?days=N, max 60)
 * GET ?amount=4999&date=YYYY-MM-DD -> payments of that amount within a day of that date:
 *                                    `match` when exactly one fits, else every `candidate`
 *     (&exclude=<payment id> lets a payment being edited keep its own pay_ id)
 * Each payment says whether it's already been recorded against an invoice,
 * so the same money can't be entered twice.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  // Each call spends the business's Razorpay API quota.
  await enforce("razorpayPerUser", user.id);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  const amount = Number(searchParams.get("amount"));
  const date = searchParams.get("date") ?? "";
  const exclude = searchParams.get("exclude") || undefined;

  try {
    if (!id && searchParams.has("amount")) {
      if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "Give an amount and a date");
      const nearby = await listRazorpayPaymentsBetween(shiftDay(date, -1), shiftDay(date, 1), 500);
      const recorded = await prisma.payment.findMany({
        where: { gatewayRef: { in: nearby.map((p) => p.id) }, ...(exclude ? { id: { not: exclude } } : {}) },
        select: { gatewayRef: true },
      });
      const taken = new Set(recorded.map((r) => r.gatewayRef!));
      const match = matchRazorpayPayment(nearby, amount, date, taken);
      const candidates = nearby
        .filter((p) => !taken.has(p.id) && Math.abs(p.amount - amount) < 0.005)
        .sort((a, b) => Number(b.paidOn === date) - Number(a.paidOn === date) || a.createdAt.localeCompare(b.createdAt))
        .map((p) => ({ ...p, recordedOn: null }));
      return NextResponse.json({ match: match ? { ...match, recordedOn: null } : null, candidates });
    }

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
