import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { calculateGatewayFee } from "@/lib/calc";
import { fetchRazorpayPayment, isRazorpayConnected } from "@/lib/integrations/razorpay";
import { badRequest } from "@/server/errors";
import { formToObject, isoDate, money, optionalText, positiveMoney } from "@/server/validation";

export interface PaymentInput {
  /** What the customer paid — this is what counts against the invoice balance. */
  amount: number;
  paidOn: Date;
  method: string | null;
  note: string | null;
  gateway: string | null;
  gatewayRef: string | null;
  feeAmount: number;
  feeGstAmount: number;
  /** Tax the customer deducted at source (TDS). Part of `amount`; never reaches the bank. */
  tdsAmount: number;
  tdsSection: string | null;
}

/** Sections a B2B customer most often deducts under. */
export const TDS_SECTIONS = ["194J", "194C", "194Q", "194H", "194I", "Other"] as const;

const paymentSchema = z.object({
  amount: positiveMoney("Payment amount"),
  paidOn: isoDate("Payment date"),
  method: optionalText(60),
  note: optionalText(500),
  gateway: optionalText(40),
  gatewayRef: optionalText(60),
  feeAmount: money("Gateway fee").optional(),
  feeGstAmount: money("GST on the gateway fee").optional(),
  tdsAmount: money("TDS").optional(),
  tdsSection: optionalText(20),
});

/**
 * Reads a payment from the record/edit form, shared by POST and PATCH so both
 * validate the same way. A Razorpay payment sent without fee figures gets them
 * from Invoice Settings, so a client that doesn't compute them still records
 * the commission.
 */
export async function readPaymentForm(form: FormData): Promise<PaymentInput> {
  const input = paymentSchema.parse(formToObject(form));
  const gateway = input.gateway;

  // TDS is part of what settles the invoice but is paid to the government, so
  // it can't exceed the payment, and gateway fees come out of the cash only.
  const tdsAmount = Math.round((input.tdsAmount ?? 0) * 100) / 100;
  if (tdsAmount < 0) throw badRequest("TDS can't be negative", { tdsAmount: "Can't be negative" });
  if (tdsAmount >= input.amount) {
    throw badRequest("TDS must be less than the amount this payment settles", { tdsAmount: "Less than the amount" });
  }
  const cash = input.amount - tdsAmount;
  const gatewayRef = gateway ? input.gatewayRef : null;

  let feeAmount = 0;
  let feeGstAmount = 0;
  if (gateway) {
    if (input.feeAmount === undefined && gateway === "Razorpay") {
      const settings = await prisma.invoiceSettings.findUnique({ where: { id: "default" } });
      const computed = calculateGatewayFee(
        cash,
        settings?.razorpayFeePercent ?? 2,
        settings?.razorpayFeeGstPercent ?? 18
      );
      feeAmount = computed.feeAmount;
      feeGstAmount = input.feeGstAmount ?? computed.feeGstAmount;
    } else {
      feeAmount = input.feeAmount ?? 0;
      feeGstAmount = input.feeGstAmount ?? 0;
    }
    if (feeAmount < 0 || feeGstAmount < 0) throw badRequest("Gateway fees can't be negative");
    if (feeAmount + feeGstAmount >= cash) {
      throw badRequest("The gateway fee must be less than the amount received", { feeAmount: "Less than the amount received" });
    }
  }

  return {
    amount: input.amount,
    paidOn: input.paidOn,
    // No platform typed on a Razorpay payment: it came through Razorpay, and
    // that's what the platform totals and sheet remarks should say.
    method: input.method ?? gateway,
    note: input.note,
    gateway,
    gatewayRef,
    feeAmount: Math.round(feeAmount * 100) / 100,
    feeGstAmount: Math.round(feeGstAmount * 100) / 100,
    tdsAmount,
    tdsSection: tdsAmount > 0 ? (input.tdsSection ?? "Other") : null,
  };
}

const refundSchema = z.object({
  amount: positiveMoney("Refund amount"),
  paidOn: isoDate("Refund date"),
  method: optionalText(60),
  note: optionalText(500),
});

export interface RefundInput {
  amount: number;
  paidOn: Date;
  method: string | null;
  note: string | null;
}

/** Money handed back to the customer after a credit note. */
export function readRefundForm(form: FormData): RefundInput {
  const input = refundSchema.parse(formToObject(form));
  return { amount: input.amount, paidOn: input.paidOn, method: input.method, note: input.note };
}

/**
 * Checks a Razorpay payment against Razorpay itself, when the account is
 * connected. Razorpay is authoritative for its own fee, so its exact figures
 * replace whatever the form estimated. The same pay_ id can only settle one
 * payment, connected or not. `excludePaymentId` is the payment being edited.
 *
 * An unreachable API doesn't block the save: the estimate stands and the
 * failure is logged, since the money has arrived either way.
 */
export async function verifyRazorpayPayment(input: PaymentInput, excludePaymentId?: string): Promise<PaymentInput> {
  if (input.gateway !== "Razorpay" || !input.gatewayRef) return input;

  const duplicate = await prisma.payment.findFirst({
    where: { gatewayRef: input.gatewayRef, ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) },
    select: { invoice: { select: { invoiceNumber: true } } },
  });
  if (duplicate) {
    throw badRequest(`Razorpay payment ${input.gatewayRef} is already recorded on ${duplicate.invoice.invoiceNumber}`);
  }

  if (!(await isRazorpayConnected())) return input;

  let payment;
  try {
    payment = await fetchRazorpayPayment(input.gatewayRef);
  } catch (e) {
    console.error(`Couldn't verify Razorpay payment ${input.gatewayRef}; keeping the estimated fee:`, e);
    return input;
  }
  if (payment.status !== "captured") {
    throw badRequest(`Razorpay says ${input.gatewayRef} is "${payment.status}", not captured — it hasn't settled`);
  }
  // The amount is left as entered: a customer can settle part of a Razorpay
  // payment against one invoice, so a mismatch isn't an error.
  return { ...input, feeAmount: payment.feeAmount, feeGstAmount: payment.feeGstAmount };
}
