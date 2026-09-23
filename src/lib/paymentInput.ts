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
}

const paymentSchema = z.object({
  amount: positiveMoney("Payment amount"),
  paidOn: isoDate("Payment date"),
  method: optionalText(60),
  note: optionalText(500),
  gateway: optionalText(40),
  gatewayRef: optionalText(60),
  feeAmount: money("Gateway fee").optional(),
  feeGstAmount: money("GST on the gateway fee").optional(),
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
  const gatewayRef = gateway ? input.gatewayRef : null;

  let feeAmount = 0;
  let feeGstAmount = 0;
  if (gateway) {
    if (input.feeAmount === undefined && gateway === "Razorpay") {
      const settings = await prisma.invoiceSettings.findUnique({ where: { id: "default" } });
      const computed = calculateGatewayFee(
        input.amount,
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
    if (feeAmount + feeGstAmount >= input.amount) {
      throw badRequest("The gateway fee must be less than the amount paid", { feeAmount: "Less than the amount paid" });
    }
  }

  return {
    amount: input.amount,
    paidOn: input.paidOn,
    method: input.method,
    note: input.note,
    gateway,
    gatewayRef,
    feeAmount: Math.round(feeAmount * 100) / 100,
    feeGstAmount: Math.round(feeGstAmount * 100) / 100,
  };
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
