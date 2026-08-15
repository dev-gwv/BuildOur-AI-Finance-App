import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { saveUpload } from "@/lib/storage";
import { syncPaymentToSheet } from "@/lib/sheet";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Expected a form submission");

  const amount = Number(form.get("amount") ?? 0);
  const paidOn = String(form.get("paidOn") ?? "");
  const method = form.get("method") ? String(form.get("method")).trim() : null;
  const note = form.get("note") ? String(form.get("note")).trim() : null;
  const proof = form.get("proof");

  if (!(amount > 0)) throw new ApiError(400, "Enter a payment amount greater than zero");
  if (!paidOn) throw new ApiError(400, "Enter the date the payment was received");

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const alreadyPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.round((invoice.grossAmount - alreadyPaid) * 100) / 100;
  if (amount > outstanding) {
    throw new ApiError(400, `That's more than the ₹${outstanding.toLocaleString("en-IN")} still outstanding`);
  }

  const proofPath = proof instanceof File && proof.size > 0 ? await saveUpload(proof) : null;

  const payment = await prisma.payment.create({
    data: { invoiceId: id, amount, paidOn: new Date(paidOn), method, note, proofPath },
  });

  // The workbook is The Mulberry Weddings' own hisaab, so only its money goes
  // in. Sent after the response: Apps Script takes seconds to answer, and none
  // of that should be spent watching a spinner over a payment already saved.
  if (invoice.brand === "MULBERRY") {
    after(() =>
      syncPaymentToSheet({
        action: "add",
        id: payment.id,
        date: payment.paidOn.toISOString().slice(0, 10),
        client: invoice.customerName,
        amount: payment.amount,
        remarks: [method, note, invoice.invoiceNumber].filter(Boolean).join(" · "),
      })
    );
  }

  return NextResponse.json({ payment }, { status: 201 });
});
