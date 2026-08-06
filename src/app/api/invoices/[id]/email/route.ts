import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { BRANDS } from "@/lib/brands";
import { invoiceEmailHtml, invoiceEmailSubject, invoiceEmailText } from "@/lib/invoiceEmail";
import { isMailConfigured, sendMail } from "@/lib/mailer";

type Params = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  if (!isMailConfigured()) {
    throw new ApiError(
      400,
      "Email isn't set up yet. Add the SMTP settings in Invoice Settings before sending."
    );
  }

  const form = await req.formData().catch(() => null);
  const override = form?.get("to") ? String(form.get("to")).trim() : "";

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const to = override || invoice.customerEmail || "";
  if (!EMAIL_RE.test(to)) {
    throw new ApiError(400, "Add a valid customer email address before sending");
  }

  const brand = BRANDS[invoice.brand];
  const amountPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const data = {
    brand: invoice.brand,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    itemDescription: invoice.itemDescription,
    total: invoice.grossAmount,
    amountPaid,
    notes: invoice.notes,
    terms: invoice.terms,
  };

  await sendMail({
    to,
    fromName: brand.name,
    subject: invoiceEmailSubject(data),
    text: invoiceEmailText(data),
    html: invoiceEmailHtml(data),
  });

  // Remember the address so the next send doesn't have to be retyped.
  await prisma.invoice.update({
    where: { id },
    data: { emailSentAt: new Date(), customerEmail: to },
  });

  return NextResponse.json({ ok: true, to });
});
