import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateGatewayFee } from "@/lib/calc";
import { syncPayment } from "@/lib/sheet";
import {
  RazorpayError,
  fetchRazorpayPayment,
  isRazorpayConnected,
  listRazorpayPaymentsBetween,
  matchRazorpayPayment,
  shiftDay,
  type RazorpayPayment,
} from "@/lib/integrations/razorpay";
import { audit } from "../audit";
import { ApiError } from "../errors";
import type { SessionUser } from "../session";
import { guardWrite, round2, rupees } from "./common";

/** How far back "update past payments" looks. */
const LOOKBACK_DAYS = 180;

export type FeeRefreshResult = {
  checked: number;
  updated: number;
  /** Razorpay payments that couldn't be matched to exactly one Razorpay record: still on the % estimate. */
  unmatched: { invoiceId: string; invoiceNumber: string; amount: number; paidOn: string }[];
};

/**
 * Brings the Razorpay commission on payments already recorded in line with
 * Razorpay's own figures: ones with a pay_ id are re-read, ones without are
 * matched by amount and date (only when exactly one Razorpay payment fits).
 * Payments marked "Razorpay" only as their platform become Razorpay payments,
 * so their commission counts. Changed rows are rewritten in the sheets.
 */
export async function refreshRazorpayFees(admin: SessionUser, req: Request): Promise<FeeRefreshResult> {
  await guardWrite(admin);
  if (!(await isRazorpayConnected())) throw new ApiError(409, "Connect Razorpay first");

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const payments = await prisma.payment.findMany({
    where: {
      kind: { not: "REFUND" },
      paidOn: { gte: since },
      OR: [{ gateway: "Razorpay" }, { gateway: null, method: { contains: "razorpay", mode: "insensitive" } }],
    },
    select: {
      id: true,
      amount: true,
      paidOn: true,
      gateway: true,
      gatewayRef: true,
      feeAmount: true,
      feeGstAmount: true,
      tdsAmount: true,
      invoice: { select: { id: true, invoiceNumber: true } },
    },
    orderBy: { paidOn: "asc" },
  });
  if (payments.length === 0) return { checked: 0, updated: 0, unmatched: [] };

  const days = payments.map((p) => p.paidOn.toISOString().slice(0, 10));
  let candidates: RazorpayPayment[];
  try {
    candidates = await listRazorpayPaymentsBetween(shiftDay(days[0], -1), shiftDay(days[days.length - 1], 1), 10_000);
  } catch (e) {
    if (e instanceof RazorpayError) throw new ApiError(e.status === 401 ? 502 : e.status, e.message);
    throw e;
  }
  const byId = new Map(candidates.map((p) => [p.id, p]));

  // Ids already recorded anywhere can't be matched to a second payment.
  const taken = new Set(
    (await prisma.payment.findMany({ where: { gatewayRef: { not: null } }, select: { gatewayRef: true } })).map((p) => p.gatewayRef!)
  );
  const settings = await prisma.invoiceSettings.findUnique({ where: { id: "default" } });

  const changes: { id: string; data: { gateway: string; gatewayRef: string | null; feeAmount: number; feeGstAmount: number } }[] = [];
  const unmatched: FeeRefreshResult["unmatched"] = [];
  const differs = (p: { feeAmount: number; feeGstAmount: number }, fee: number, gst: number) =>
    Math.abs(p.feeAmount - fee) >= 0.005 || Math.abs(p.feeGstAmount - gst) >= 0.005;

  // Payments that name their pay_ id first, so they keep it before any amount matching.
  for (const p of payments.filter((x) => x.gatewayRef)) {
    let rp = byId.get(p.gatewayRef!) ?? null;
    if (!rp) rp = await fetchRazorpayPayment(p.gatewayRef!).catch(() => null);
    if (rp && (differs(p, rp.feeAmount, rp.feeGstAmount) || p.gateway !== "Razorpay")) {
      changes.push({ id: p.id, data: { gateway: "Razorpay", gatewayRef: rp.id, feeAmount: rp.feeAmount, feeGstAmount: rp.feeGstAmount } });
    }
  }
  for (const p of payments.filter((x) => !x.gatewayRef)) {
    const day = p.paidOn.toISOString().slice(0, 10);
    const cash = round2(p.amount - p.tdsAmount);
    const rp = matchRazorpayPayment(candidates, cash, day, taken);
    if (rp) {
      taken.add(rp.id);
      changes.push({ id: p.id, data: { gateway: "Razorpay", gatewayRef: rp.id, feeAmount: rp.feeAmount, feeGstAmount: rp.feeGstAmount } });
      continue;
    }
    unmatched.push({ invoiceId: p.invoice.id, invoiceNumber: p.invoice.invoiceNumber, amount: p.amount, paidOn: day });
    // Recorded with "Razorpay" only as the platform: at least the % estimate applies.
    if (p.gateway !== "Razorpay") {
      const est = calculateGatewayFee(cash, settings?.razorpayFeePercent ?? 2, settings?.razorpayFeeGstPercent ?? 18);
      changes.push({ id: p.id, data: { gateway: "Razorpay", gatewayRef: null, feeAmount: est.feeAmount, feeGstAmount: est.feeGstAmount } });
    }
  }

  if (changes.length) {
    await prisma.$transaction(changes.map((c) => prisma.payment.update({ where: { id: c.id }, data: c.data })));
    const before = payments.reduce((s, p) => s + p.feeAmount + p.feeGstAmount, 0);
    const afterTotal = before + changes.reduce((s, c) => {
      const p = payments.find((x) => x.id === c.id)!;
      return s + c.data.feeAmount + c.data.feeGstAmount - p.feeAmount - p.feeGstAmount;
    }, 0);
    await audit({
      user: admin,
      action: "razorpay.fees",
      entityType: "integration",
      entityId: "razorpay",
      summary: `Updated Razorpay fees on ${changes.length} payment${changes.length === 1 ? "" : "s"} (total fees ${rupees(before)} → ${rupees(afterTotal)})`,
      req,
    });
    after(async () => {
      for (const c of changes) await syncPayment(c.id);
    });
  }
  return { checked: payments.length, updated: changes.length, unmatched };
}
