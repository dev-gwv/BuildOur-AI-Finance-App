import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { unsyncPayment } from "@/lib/sheet";
import { calculateInvoiceBreakup } from "@/lib/invoiceCalc";
import { isInterStateSupply } from "@/lib/gstState";
import { invoiceBalance } from "@/lib/invoiceLines";
import { todayISO } from "@/lib/dates";
import { requireInvoiceAccess } from "../access";
import { audit } from "../audit";
import { allocateCreditNoteNumber } from "../businesses";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { assertPeriodOpen } from "../gstLock";
import { isAdmin, type SessionUser } from "../session";
import { isoDate, percent, positiveMoney, requiredText } from "../validation";
import { guardWrite, round2, rupees } from "./common";

// Credit notes and cancellation: the GST-correct ways to undo or reduce an
// issued invoice. An issued invoice's number is never freed and its figures
// are never silently rewritten once it's in a filed return.

export const CREDIT_NOTE_REASONS = [
  "Price correction",
  "Discount after sale",
  "Goods or service returned",
  "Other",
] as const;

export const creditNoteSchema = z.object({
  noteDate: isoDate("Credit note date"),
  reason: requiredText("Reason", 300),
  grossAmount: positiveMoney("Amount"),
  gstPercent: percent("GST %").optional(),
});

export const cancelSchema = z.object({
  reason: requiredText("Reason", 300),
});

/** What the balance rule needs about an invoice, plus what the tax split needs. */
async function loadInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      businessId: true,
      brand: true,
      status: true,
      invoiceNumber: true,
      invoiceDate: true,
      customerName: true,
      customerGstin: true,
      placeOfSupply: true,
      grossAmount: true,
      gstPercent: true,
      lines: { select: { gstPercent: true, grossAmount: true }, orderBy: { position: "asc" } },
      creditNotes: { select: { id: true, grossAmount: true } },
      payments: { select: { id: true, amount: true, kind: true, tdsAmount: true } },
    },
  });
  if (!invoice) throw notFound("That invoice");
  return invoice;
}

/** The rate a credit note defaults to: the invoice's (largest line's) rate. */
function defaultRate(invoice: Awaited<ReturnType<typeof loadInvoice>>): number {
  if (invoice.brand !== "GRATEFUL") return 0;
  const biggest = [...invoice.lines].sort((a, b) => b.grossAmount - a.grossAmount)[0];
  return biggest?.gstPercent ?? invoice.gstPercent;
}

/** A credit note's tax split, on the same supply type (CGST+SGST or IGST) as its invoice. */
export function creditNoteTax(
  cn: { grossAmount: number; gstPercent: number },
  invoice: { customerGstin: string | null; placeOfSupply: string }
) {
  const b = calculateInvoiceBreakup({
    grossAmount: cn.grossAmount,
    gstPercent: cn.gstPercent,
    qty: 1,
    isInterState: isInterStateSupply(invoice.customerGstin, invoice.placeOfSupply),
  });
  return { taxable: b.subTotal, cgst: b.cgstAmount, sgst: b.sgstAmount, igst: b.igstAmount, taxMode: b.taxMode };
}

export async function createCreditNote(
  user: SessionUser,
  invoiceId: string,
  input: z.infer<typeof creditNoteSchema>,
  req: Request
) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);
  const invoice = await loadInvoice(invoiceId);
  if (invoice.status === "CANCELLED") throw conflict("A cancelled invoice can't have a credit note");

  if (input.noteDate < invoice.invoiceDate) {
    throw badRequest("A credit note can't be dated before its invoice", { noteDate: "Before the invoice date" });
  }
  if (input.noteDate.toISOString().slice(0, 10) > todayISO()) {
    throw badRequest("A credit note can't be dated in the future", { noteDate: "In the future" });
  }
  await assertPeriodOpen(invoice.businessId, [input.noteDate], "That credit note date");

  const { net } = invoiceBalance(invoice);
  if (input.grossAmount > net + 0.005) {
    throw badRequest(`At most ${rupees(net)} can be credited on this invoice`, { grossAmount: `At most ${rupees(net)}` });
  }
  const gstPercent = invoice.brand === "GRATEFUL" ? (input.gstPercent ?? defaultRate(invoice)) : 0;

  const creditNote = await prisma.$transaction(async (tx) => {
    const number = await allocateCreditNoteNumber(tx, invoice.businessId, input.noteDate);
    return tx.creditNote.create({
      data: {
        businessId: invoice.businessId,
        invoiceId,
        number,
        noteDate: input.noteDate,
        reason: input.reason,
        grossAmount: round2(input.grossAmount),
        gstPercent,
        createdById: user.id,
      },
    });
  });

  await audit({
    user,
    businessId: invoice.businessId,
    action: "creditNote.create",
    entityType: "invoice",
    entityId: invoiceId,
    summary: `Issued credit note ${creditNote.number} for ${rupees(creditNote.grossAmount)} on ${invoice.invoiceNumber} (${input.reason})`,
    req,
  });
  return creditNote;
}

export async function deleteCreditNote(user: SessionUser, creditNoteId: string, req: Request) {
  await guardWrite(user);
  if (!isAdmin(user)) throw forbidden("Only an admin can delete a credit note");
  const cn = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    select: { id: true, number: true, businessId: true, invoiceId: true, noteDate: true, grossAmount: true, invoice: { select: { invoiceNumber: true } } },
  });
  if (!cn) throw notFound("That credit note");
  await requireInvoiceAccess(user, cn.invoiceId);
  await assertPeriodOpen(cn.businessId, [cn.noteDate], "That credit note");

  await prisma.creditNote.delete({ where: { id: creditNoteId } });
  await audit({
    user,
    businessId: cn.businessId,
    action: "creditNote.delete",
    entityType: "invoice",
    entityId: cn.invoiceId,
    summary: `Deleted credit note ${cn.number} (${rupees(cn.grossAmount)}) on ${cn.invoice.invoiceNumber}`,
    req,
  });
}

/**
 * Cancels an invoice raised by mistake. It keeps its number (GST numbering
 * can't have gaps) but counts for nothing anywhere. Only possible while
 * nothing is left received against it and no credit note exists — after
 * that, a credit note is the correct way to reduce it.
 */
export async function cancelInvoice(user: SessionUser, invoiceId: string, reason: string, req: Request) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);
  const invoice = await loadInvoice(invoiceId);
  if (invoice.status === "CANCELLED") throw conflict("This invoice is already cancelled");
  if (invoice.creditNotes.length > 0) {
    throw conflict("This invoice has a credit note — issue a further credit note instead of cancelling it");
  }
  const bal = invoiceBalance(invoice);
  if (round2(bal.received - bal.refunded) > 0.5) {
    throw conflict(
      `${rupees(bal.received - bal.refunded)} has been received against this invoice. Refund it (or delete the payment if it was recorded by mistake) before cancelling, or issue a credit note.`
    );
  }
  await assertPeriodOpen(invoice.businessId, [invoice.invoiceDate], "This invoice");

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
  });
  await audit({
    user,
    businessId: invoice.businessId,
    action: "invoice.cancel",
    entityType: "invoice",
    entityId: invoiceId,
    summary: `Cancelled ${invoice.invoiceNumber} (${invoice.customerName}, ${rupees(invoice.grossAmount)}): ${reason}`,
    req,
  });

  // Any payment rows it had (a receipt and its refund) leave the sheet with it.
  if (invoice.payments.length) {
    after(async () => {
      for (const p of invoice.payments) await unsyncPayment(invoice.businessId, p.id);
    });
  }
}
