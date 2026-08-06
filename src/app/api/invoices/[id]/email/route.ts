import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { BRANDS } from "@/lib/brands";
import { invoiceEmailHtml, invoiceEmailText } from "@/lib/invoiceEmail";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { renderTemplate, templateVars } from "@/lib/emailTemplate";
import { templateFor } from "@/lib/templateStore";

type Params = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The draft shown in the compose box: template wording with placeholders filled. */
export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const amountPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const template = await templateFor(invoice.brand);
  const vars = templateVars({
    brand: invoice.brand,
    customerName: invoice.customerName,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    total: invoice.grossAmount,
    balanceDue: invoice.grossAmount - amountPaid,
    itemDescription: invoice.itemDescription,
  });

  return NextResponse.json({
    to: invoice.customerEmail ?? "",
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
    configured: isMailConfigured(),
  });
});

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

  // The sender may tweak the wording for this one email; otherwise the brand's
  // saved template is used, with placeholders filled in.
  const template = await templateFor(invoice.brand);
  const vars = templateVars({
    brand: invoice.brand,
    customerName: invoice.customerName,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    total: invoice.grossAmount,
    balanceDue: invoice.grossAmount - amountPaid,
    itemDescription: invoice.itemDescription,
  });

  const subject = renderTemplate(
    form?.get("subject") ? String(form.get("subject")) : template.subject,
    vars
  );
  const message = renderTemplate(form?.get("body") ? String(form.get("body")) : template.body, vars);

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
    message,
  };

  await sendMail({
    to,
    fromName: brand.name,
    subject,
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
