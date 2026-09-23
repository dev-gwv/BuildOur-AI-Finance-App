import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { syncPayment, unsyncPayment } from "@/lib/sheet";
import { readPaymentForm, verifyRazorpayPayment } from "@/lib/paymentInput";
import { requireInvoiceAccess, requirePaymentAccess } from "../access";
import { audit, diff } from "../audit";
import { badRequest } from "../errors";
import type { SessionUser } from "../session";
import { guardWrite, round2, rupees } from "./common";

const PROOF_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const MAX_PROOF = 4 * 1024 * 1024;

async function storeProof(proof: FormDataEntryValue | null): Promise<string | null> {
  if (!(proof instanceof File) || proof.size === 0) return null;
  if (proof.type && !PROOF_TYPES.includes(proof.type)) throw badRequest("Proof must be an image or a PDF");
  if (proof.size > MAX_PROOF) throw badRequest("Proof must be under 4 MB");
  return saveUpload(proof);
}

const LABELS = {
  amount: "amount",
  paidOn: "date",
  method: "method",
  note: "note",
  gateway: "gateway",
  gatewayRef: "gateway ref",
  feeAmount: "fee",
  feeGstAmount: "fee GST",
} as const;

export async function recordPayment(user: SessionUser, invoiceId: string, form: FormData, req: Request) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);
  const input = await verifyRazorpayPayment(await readPaymentForm(form));

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: { select: { amount: true } } },
  });
  // The customer's full payment settles the invoice; a gateway's cut comes out
  // of what the business receives, not out of what the customer owes.
  const outstanding = round2(invoice.grossAmount - invoice.payments.reduce((s, p) => s + p.amount, 0));
  if (input.amount > outstanding + 0.005) {
    throw badRequest(`That's more than the ${rupees(outstanding)} still outstanding`, { amount: `At most ${rupees(outstanding)}` });
  }

  const proofPath = await storeProof(form.get("proof"));
  const payment = await prisma.payment.create({ data: { invoiceId, ...input, proofPath } });

  await audit({
    user,
    businessId: invoice.businessId,
    action: "payment.create",
    entityType: "payment",
    entityId: payment.id,
    summary: `Recorded ${rupees(payment.amount)} on ${invoice.invoiceNumber}${payment.method ? ` via ${payment.method}` : ""}${
      payment.feeAmount + payment.feeGstAmount > 0 ? ` (fees ${rupees(payment.feeAmount + payment.feeGstAmount)})` : ""
    }`,
    req,
  });

  // Sent after the response: Apps Script takes seconds to answer.
  after(() => syncPayment(payment.id));
  return payment;
}

export async function updatePayment(user: SessionUser, paymentId: string, form: FormData, req: Request) {
  await guardWrite(user);
  const access = await requirePaymentAccess(user, paymentId);
  const input = await verifyRazorpayPayment(await readPaymentForm(form), paymentId);

  const existing = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { invoice: { select: { grossAmount: true, invoiceNumber: true, payments: { select: { id: true, amount: true } } } } },
  });
  // Measured against the other payments only: this one's old amount is being replaced.
  const others = existing.invoice.payments.filter((p) => p.id !== paymentId).reduce((s, p) => s + p.amount, 0);
  const available = round2(existing.invoice.grossAmount - others);
  if (input.amount > available + 0.005) {
    throw badRequest(`That's more than the ${rupees(available)} this invoice has left to pay`, { amount: `At most ${rupees(available)}` });
  }

  const newProof = await storeProof(form.get("proof"));
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { ...input, ...(newProof ? { proofPath: newProof } : {}) },
  });
  if (newProof && existing.proofPath) await deleteUpload(existing.proofPath).catch(() => {});

  const changed = diff(existing, input, LABELS);
  await audit({
    user,
    businessId: access.invoice.businessId,
    action: "payment.update",
    entityType: "payment",
    entityId: paymentId,
    summary: `Edited payment on ${existing.invoice.invoiceNumber}: ${changed.summary || (newProof ? "new proof" : "no changes")}`,
    changes: changed.changes,
    req,
  });

  // Rewrites the same sheet row (or moves it, if the date changed its month).
  after(() => syncPayment(paymentId));
  return payment;
}

export async function deletePayment(user: SessionUser, paymentId: string, req: Request) {
  await guardWrite(user);
  const access = await requirePaymentAccess(user, paymentId);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  await prisma.payment.delete({ where: { id: paymentId } });
  // The screenshot is stored outside the database; dropping only the row would
  // leave it billed and unreachable.
  if (payment.proofPath) await deleteUpload(payment.proofPath).catch(() => {});

  await audit({
    user,
    businessId: access.invoice.businessId,
    action: "payment.delete",
    entityType: "payment",
    entityId: paymentId,
    summary: `Deleted ${rupees(payment.amount)} payment from ${access.invoice.invoiceNumber}`,
    req,
  });

  // A payment removed here must not stay in the sheet, or its month stops adding up.
  after(() => unsyncPayment(access.invoice.businessId, paymentId));
}
