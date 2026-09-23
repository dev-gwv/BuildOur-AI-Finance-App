import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { UnsupportedUpload, deleteUpload, saveUpload } from "@/lib/storage";
import { syncPayment, unsyncPayment } from "@/lib/sheet";
import { readPaymentForm, readRefundForm, verifyRazorpayPayment } from "@/lib/paymentInput";
import { invoiceBalance } from "@/lib/invoiceLines";
import { requireInvoiceAccess, requirePaymentAccess } from "../access";
import { audit, diff } from "../audit";
import { badRequest, conflict } from "../errors";
import { isoDate, optionalText, positiveMoney } from "../validation";
import { BAJAJ_DISBURSEMENT } from "./invoices";
import type { SessionUser } from "../session";
import { guardWrite, round2, rupees } from "./common";

const PROOF_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_PROOF = 4 * 1024 * 1024;

const PROOF_NOT_SAVED = "The payment was saved, but its screenshot couldn't be attached.";

/**
 * Stores the payment's screenshot. The money received is what matters: if
 * storage is unavailable the payment is still recorded, with a warning, rather
 * than lost. A wrong file type or size is still refused — that's the user's to fix.
 */
async function storeProof(proof: FormDataEntryValue | null): Promise<{ path: string | null; warning: string | null }> {
  if (!(proof instanceof File) || proof.size === 0) return { path: null, warning: null };
  if (!PROOF_TYPES.includes(proof.type)) throw badRequest("Proof must be a PDF, PNG, JPG or WebP");
  if (proof.size > MAX_PROOF) throw badRequest("Proof must be under 4 MB");
  try {
    return { path: await saveUpload(proof), warning: null };
  } catch (e) {
    // Bytes that aren't a real image/PDF are refused, not saved around.
    if (e instanceof UnsupportedUpload) throw badRequest(e.message);
    console.error("Couldn't store a payment screenshot; saving the payment without it:", e);
    return { path: null, warning: PROOF_NOT_SAVED };
  }
}

/**
 * The invoice's balance by the one rule every screen uses (credit notes,
 * refunds, TDS, cancellation), optionally leaving out one payment - the one
 * being edited, whose old amount is about to be replaced.
 */
async function balanceOf(invoiceId: string, excludePaymentId?: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      payments: { select: { id: true, amount: true, kind: true, tdsAmount: true, method: true } },
      creditNotes: { select: { grossAmount: true } },
    },
  });
  const payments = invoice.payments.filter((p) => p.id !== excludePaymentId);
  return { invoice, payments, balance: invoiceBalance({ ...invoice, payments }) };
}

function assertNotCancelled(invoice: { status: string; invoiceNumber: string }) {
  if (invoice.status === "CANCELLED") throw conflict(`${invoice.invoiceNumber} is cancelled, so no money can be recorded against it`);
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
  tdsAmount: "TDS",
  tdsSection: "TDS section",
} as const;

export async function recordPayment(user: SessionUser, invoiceId: string, form: FormData, req: Request) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);
  const input = await verifyRazorpayPayment(await readPaymentForm(form));

  const { invoice, balance } = await balanceOf(invoiceId);
  assertNotCancelled(invoice);
  // The customer's full payment settles the invoice; a gateway's cut and any
  // TDS come out of what the business receives, not out of what's owed.
  const outstanding = balance.balance;
  if (outstanding <= 0) throw badRequest(`${invoice.invoiceNumber} has nothing left to pay`);
  if (input.amount > outstanding + 0.005) {
    throw badRequest(`That's more than the ${rupees(outstanding)} still outstanding`, { amount: `At most ${rupees(outstanding)}` });
  }

  const { path: proofPath, warning } = await storeProof(form.get("proof"));
  const payment = await prisma.payment.create({ data: { invoiceId, ...input, proofPath } });

  await audit({
    user,
    businessId: invoice.businessId,
    action: "payment.create",
    entityType: "payment",
    entityId: payment.id,
    summary: `Recorded ${rupees(payment.amount)} on ${invoice.invoiceNumber}${payment.method ? ` via ${payment.method}` : ""}${
      payment.feeAmount + payment.feeGstAmount > 0 ? ` (fees ${rupees(payment.feeAmount + payment.feeGstAmount)})` : ""
    }${payment.tdsAmount > 0 ? ` (TDS ${payment.tdsSection ?? ""} ${rupees(payment.tdsAmount)})` : ""}`,
    req,
  });

  // Sent after the response: Apps Script takes seconds to answer.
  after(() => syncPayment(payment.id));
  return { payment, warning };
}

export async function updatePayment(user: SessionUser, paymentId: string, form: FormData, req: Request) {
  await guardWrite(user);
  const access = await requirePaymentAccess(user, paymentId);
  const existing = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  if (existing.kind === "REFUND") {
    throw badRequest("A refund can't be edited. Delete it and record it again.");
  }
  const input = await verifyRazorpayPayment(await readPaymentForm(form), paymentId);

  // Measured against the other payments only: this one's old amount is being replaced.
  const { balance } = await balanceOf(existing.invoiceId, paymentId);
  const available = balance.balance;
  if (input.amount > available + 0.005) {
    throw badRequest(`That's more than the ${rupees(available)} this invoice has left to pay`, { amount: `At most ${rupees(available)}` });
  }

  const { path: newProof, warning } = await storeProof(form.get("proof"));
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
  return { payment, warning };
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

export const bajajDisbursementSchema = z.object({
  /** What Bajaj actually credited to the bank account. */
  credited: positiveMoney("Amount credited"),
  paidOn: isoDate("Date credited"),
  /** UTR / bank reference for the credit. */
  reference: optionalText(60),
});

/**
 * Records Bajaj Finance paying out a financed sale. Bajaj pays the financed
 * amount less its dealer charges (subvention / MDR / processing): the payment
 * settles the whole financed amount against the invoice, and the difference is
 * booked as Bajaj's fee — the same way a Razorpay commission is — so "collected"
 * and "landed in the bank" both come out right.
 */
export async function recordBajajDisbursement(
  user: SessionUser,
  invoiceId: string,
  input: z.infer<typeof bajajDisbursementSchema>,
  req: Request
) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);

  const { invoice, payments, balance } = await balanceOf(invoiceId);
  assertNotCancelled(invoice);
  if (invoice.saleType !== "BAJAJ") throw badRequest("This isn't a Bajaj Finance sale");
  if (payments.some((p) => p.method === BAJAJ_DISBURSEMENT)) {
    throw conflict("Bajaj's disbursement is already recorded on this invoice — edit that payment instead");
  }

  const outstanding = balance.balance;
  const settles = round2(Math.min(invoice.financedAmount ?? outstanding, outstanding));
  if (settles <= 0) throw badRequest("Nothing is left for Bajaj to pay on this invoice");
  if (input.credited > settles + 0.005) {
    throw badRequest(`Bajaj can't have paid more than the ${rupees(settles)} it financed`, {
      credited: `At most ${rupees(settles)}`,
    });
  }

  const charges = round2(settles - input.credited);
  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      amount: settles,
      paidOn: input.paidOn,
      method: BAJAJ_DISBURSEMENT,
      gateway: "Bajaj Finance",
      gatewayRef: input.reference ?? invoice.doId,
      feeAmount: charges,
      feeGstAmount: 0,
    },
  });

  await audit({
    user,
    businessId: invoice.businessId,
    action: "payment.create",
    entityType: "payment",
    entityId: payment.id,
    summary: `Bajaj disbursed ${rupees(input.credited)} on ${invoice.invoiceNumber} against ${rupees(settles)} financed (charges ${rupees(charges)})`,
    req,
  });

  after(() => syncPayment(payment.id));
  return { payment };
}

/**
 * Records money handed back to the customer. Only possible once a credit note
 * has left the invoice overpaid, and never more than that overpayment.
 */
export async function recordRefund(user: SessionUser, invoiceId: string, form: FormData, req: Request) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);
  const input = readRefundForm(form);
  const { invoice, balance } = await balanceOf(invoiceId);
  if (balance.toRefund <= 0) throw badRequest(`Nothing is owed back to the customer on ${invoice.invoiceNumber}`);
  if (input.amount > balance.toRefund + 0.005) {
    throw badRequest(`That's more than the ${rupees(balance.toRefund)} to refund`, { amount: `At most ${rupees(balance.toRefund)}` });
  }

  const payment = await prisma.payment.create({
    data: { invoiceId, kind: "REFUND", amount: input.amount, paidOn: input.paidOn, method: input.method, note: input.note },
  });
  await audit({
    user,
    businessId: invoice.businessId,
    action: "payment.refund",
    entityType: "payment",
    entityId: payment.id,
    summary: `Refunded ${rupees(payment.amount)} on ${invoice.invoiceNumber}${payment.method ? ` via ${payment.method}` : ""}`,
    req,
  });
  after(() => syncPayment(payment.id));
  return { payment };
}
