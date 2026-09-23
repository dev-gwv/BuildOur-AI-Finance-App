import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { syncInvoicePayments, unsyncPayment } from "@/lib/sheet";
import { ledgerForInvoice } from "@/lib/ventures";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ invoice });
});

/** Method recorded on the payment a Bajaj DO invoice gets when it's raised. */
const BAJAJ_DISBURSEMENT = "Bajaj Finance disbursement";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optional = (v: unknown) => text(v) || null;

export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new ApiError(400, "Expected a JSON body");

  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { id: true, amount: true, method: true } } },
  });
  if (!existing) throw new ApiError(404, "Invoice not found");

  const invoiceNumber = text(body.invoiceNumber);
  const invoiceDate = text(body.invoiceDate);
  const dueDate = text(body.dueDate) || invoiceDate;
  const customerName = text(body.customerName);
  const customerAddress = text(body.customerAddress);
  const placeOfSupply = text(body.placeOfSupply);
  const itemDescription = text(body.itemDescription);
  const hsnSac = text(body.hsnSac);
  const qty = Number(body.qty ?? existing.qty);
  const grossAmount = Number(body.grossAmount);
  // Mulberry isn't GST-registered; its stored rate is left as it was.
  const isMulberry = existing.brand === "MULBERRY";
  const gstPercent = isMulberry ? existing.gstPercent : Number(body.gstPercent ?? existing.gstPercent);
  const customerGstin = isMulberry ? existing.customerGstin : optional(body.customerGstin)?.toUpperCase() ?? null;

  if (!invoiceNumber || !invoiceDate || !customerName || !customerAddress || !itemDescription) {
    throw new ApiError(400, "Invoice number, date, customer name, address and item are required");
  }
  if (!(grossAmount > 0)) throw new ApiError(400, "Enter an amount greater than zero");
  if (!(qty > 0)) throw new ApiError(400, "Quantity must be greater than zero");
  if (!(gstPercent >= 0)) throw new ApiError(400, "GST % can't be negative");
  if (Number.isNaN(new Date(invoiceDate).getTime()) || Number.isNaN(new Date(dueDate).getTime())) {
    throw new ApiError(400, "Enter valid invoice and due dates");
  }

  if (invoiceNumber !== existing.invoiceNumber) {
    const clash = await prisma.invoice.findUnique({ where: { invoiceNumber }, select: { id: true } });
    if (clash && clash.id !== id) throw new ApiError(400, `Invoice ${invoiceNumber} already exists`);
  }

  // A Bajaj DO invoice was marked paid by its disbursement when raised. If that
  // is still its only payment, the disbursement follows the corrected amount
  // rather than blocking the edit.
  const [only] = existing.payments;
  const bajajPayment =
    existing.payments.length === 1 && only.method === BAJAJ_DISBURSEMENT && only.amount === existing.grossAmount
      ? only
      : null;

  const paid = existing.payments.reduce((s, p) => s + p.amount, 0);
  if (!bajajPayment && grossAmount < paid - 0.005) {
    throw new ApiError(
      400,
      `₹${paid.toLocaleString("en-IN")} has already been received against this invoice — the amount can't go below that`
    );
  }

  const [invoice] = await prisma.$transaction([
    prisma.invoice.update({
      where: { id },
      data: {
        invoiceNumber,
        invoiceDate: new Date(invoiceDate),
        dueDate: new Date(dueDate),
        customerName,
        customerAddress,
        customerEmail: optional(body.customerEmail),
        customerGstin,
        placeOfSupply,
        itemDescription,
        hsnSac,
        qty,
        grossAmount,
        gstPercent,
        notes: optional(body.notes),
        terms: optional(body.terms),
        // The customer already holds the emailed copy, so this one is a revision.
        ...(existing.emailSentAt ? { revisedAt: new Date() } : {}),
      },
    }),
    ...(bajajPayment
      ? [
          prisma.payment.update({
            where: { id: bajajPayment.id },
            data: { amount: grossAmount, paidOn: new Date(invoiceDate) },
          }),
        ]
      : []),
  ]);

  // Customer name, invoice number and amounts appear on every payment's sheet
  // row; they're rewritten in place.
  if (existing.payments.length > 0) after(() => syncInvoicePayments(id));

  return NextResponse.json({ invoice });
});

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { brand: true, venture: true, payments: { select: { id: true } } },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.invoice.delete({ where: { id } });

  // Its payments go with it (cascade), so their sheet rows must go too.
  const ledger = ledgerForInvoice(invoice);
  if (ledger && invoice.payments.length > 0) {
    after(async () => {
      for (const p of invoice.payments) {
        await unsyncPayment(ledger, p.id);
      }
    });
  }
  return NextResponse.json({ ok: true });
});
