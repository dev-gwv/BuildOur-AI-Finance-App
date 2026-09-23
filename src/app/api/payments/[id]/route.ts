import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { syncPayment, unsyncPayment } from "@/lib/sheet";
import { readPaymentForm, verifyRazorpayPayment } from "@/lib/paymentInput";
import { ledgerForInvoice } from "@/lib/ventures";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Expected a form submission");

  const existing = await prisma.payment.findUnique({
    where: { id },
    include: { invoice: { select: { grossAmount: true, payments: { select: { id: true, amount: true } } } } },
  });
  if (!existing) throw new ApiError(404, "Payment not found");

  const input = await verifyRazorpayPayment(await readPaymentForm(form), id);

  // Measured against the other payments only: this one's old amount is being replaced.
  const others = existing.invoice.payments.filter((p) => p.id !== id).reduce((sum, p) => sum + p.amount, 0);
  const available = Math.round((existing.invoice.grossAmount - others) * 100) / 100;
  if (input.amount > available) {
    throw new ApiError(400, `That's more than the ₹${available.toLocaleString("en-IN")} this invoice has left to pay`);
  }

  const proof = form.get("proof");
  let proofPath = existing.proofPath;
  if (proof instanceof File && proof.size > 0) {
    proofPath = await saveUpload(proof);
    if (existing.proofPath) await deleteUpload(existing.proofPath).catch(() => {});
  }

  const payment = await prisma.payment.update({
    where: { id },
    data: { ...input, proofPath },
  });

  // Rewrites the same sheet row (or moves it, if the date changed its month).
  after(() => syncPayment(id));

  return NextResponse.json({ payment });
});

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { invoice: { select: { brand: true, venture: true } } },
  });
  if (!payment) throw new ApiError(404, "Payment not found");

  await prisma.payment.delete({ where: { id } });
  // The screenshot is stored outside the database, so dropping the row alone
  // would leave it billed and unreachable forever — same cleanup expenses do.
  if (payment.proofPath) {
    await deleteUpload(payment.proofPath).catch(() => {});
  }
  // A payment removed here must not stay in the sheet, or its month stops
  // adding up. An id the sheet never had is a no-op there.
  const ledger = ledgerForInvoice(payment.invoice);
  after(() => unsyncPayment(ledger, id));

  return NextResponse.json({ ok: true });
});
