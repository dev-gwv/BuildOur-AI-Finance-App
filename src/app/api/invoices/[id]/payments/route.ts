import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { saveUpload } from "@/lib/storage";
import { syncPayment } from "@/lib/sheet";
import { readPaymentForm, verifyRazorpayPayment } from "@/lib/paymentInput";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Expected a form submission");

  const input = await verifyRazorpayPayment(await readPaymentForm(form));
  const proof = form.get("proof");

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  // The customer's full payment settles the invoice; a gateway's cut comes out
  // of what the business receives, not out of what the customer owes.
  const alreadyPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.round((invoice.grossAmount - alreadyPaid) * 100) / 100;
  if (input.amount > outstanding) {
    throw new ApiError(400, `That's more than the ₹${outstanding.toLocaleString("en-IN")} still outstanding`);
  }

  const proofPath = proof instanceof File && proof.size > 0 ? await saveUpload(proof) : null;

  const payment = await prisma.payment.create({
    data: { invoiceId: id, ...input, proofPath },
  });

  // Mulberry, IPC and IWC each keep their own workbook; legacy Grateful
  // invoices have none. Sent after the response: Apps Script takes seconds to
  // answer, and none of that should be spent watching a spinner over a payment
  // already saved.
  after(() => syncPayment(payment.id));

  return NextResponse.json({ payment }, { status: 201 });
});
