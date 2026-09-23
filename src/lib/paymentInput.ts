import { ApiError } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { calculateGatewayFee } from "@/lib/calc";
import { fetchRazorpayPayment, isRazorpayConnected } from "@/lib/integrations/razorpay";

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

function optionalNumber(value: FormDataEntryValue | null): number | null {
  if (value === null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ApiError(400, "Gateway fees must be numbers");
  return n;
}

/**
 * Reads a payment from the record/edit form, shared by POST and PATCH so both
 * validate the same way. A Razorpay payment sent without fee figures gets them
 * from Invoice Settings, so a client that doesn't compute them still records
 * the commission.
 */
export async function readPaymentForm(form: FormData): Promise<PaymentInput> {
  const amount = Number(form.get("amount") ?? 0);
  const paidOnRaw = String(form.get("paidOn") ?? "");
  const method = form.get("method") ? String(form.get("method")).trim() || null : null;
  const note = form.get("note") ? String(form.get("note")).trim() || null : null;
  const gateway = form.get("gateway") ? String(form.get("gateway")).trim().slice(0, 40) || null : null;
  const gatewayRef = gateway && form.get("gatewayRef") ? String(form.get("gatewayRef")).trim().slice(0, 60) || null : null;

  if (!(amount > 0)) throw new ApiError(400, "Enter a payment amount greater than zero");
  if (!paidOnRaw || Number.isNaN(new Date(paidOnRaw).getTime())) {
    throw new ApiError(400, "Enter the date the payment was received");
  }

  let feeAmount = 0;
  let feeGstAmount = 0;
  if (gateway) {
    const fee = optionalNumber(form.get("feeAmount"));
    const feeGst = optionalNumber(form.get("feeGstAmount"));
    if (fee === null && gateway === "Razorpay") {
      const settings = await prisma.invoiceSettings.findUnique({ where: { id: "default" } });
      const computed = calculateGatewayFee(
        amount,
        settings?.razorpayFeePercent ?? 2,
        settings?.razorpayFeeGstPercent ?? 18
      );
      feeAmount = computed.feeAmount;
      feeGstAmount = feeGst ?? computed.feeGstAmount;
    } else {
      feeAmount = fee ?? 0;
      feeGstAmount = feeGst ?? 0;
    }
    if (feeAmount < 0 || feeGstAmount < 0) throw new ApiError(400, "Gateway fees can't be negative");
    if (feeAmount + feeGstAmount >= amount) {
      throw new ApiError(400, "The gateway fee must be less than the amount paid");
    }
  }

  return {
    amount,
    paidOn: new Date(paidOnRaw),
    method,
    note,
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
    throw new ApiError(400, `Razorpay payment ${input.gatewayRef} is already recorded on ${duplicate.invoice.invoiceNumber}`);
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
    throw new ApiError(400, `Razorpay says ${input.gatewayRef} is "${payment.status}", not captured — it hasn't settled`);
  }
  // The amount is left as entered: a customer can settle part of a Razorpay
  // payment against one invoice, so a mismatch isn't an error.
  return { ...input, feeAmount: payment.feeAmount, feeGstAmount: payment.feeGstAmount };
}
