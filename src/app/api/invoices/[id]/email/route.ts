import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { requireInvoiceAccess } from "@/server/access";
import { enforce } from "@/server/rateLimit";
import { audit } from "@/server/audit";
import { BRANDS } from "@/lib/brands";
import { invoiceEmailHtml, invoiceEmailText } from "@/lib/invoiceEmail";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { renderTemplate, templateVars } from "@/lib/emailTemplate";
import { templateFor } from "@/lib/templateStore";

type Params = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The draft shown in the compose box: template wording with placeholders filled. */
export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await requireInvoiceAccess(user, id);

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
  const user = await requireUser();
  const { id } = await params;
  const access = await requireInvoiceAccess(user, id);
  // A leaked session mustn't be able to use the business's mail account to spam.
  await enforce("emailPerUser", user.id);

  if (!isMailConfigured()) {
    throw new ApiError(
      400,
      "Email isn't set up yet. Add the SMTP settings in Invoice Settings before sending."
    );
  }

  const form = await req.formData().catch(() => null);
  const override = form?.get("to") ? String(form.get("to")).trim().slice(0, 254) : "";
  const subjectOverride = form?.get("subject") ? String(form.get("subject")).slice(0, 300) : "";
  const bodyOverride = form?.get("body") ? String(form.get("body")).slice(0, 20_000) : "";

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const to = override || invoice.customerEmail || "";
  if (!EMAIL_RE.test(to)) throw badRequest("Add a valid customer email address before sending", { to: "Not a valid email" });

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

  // Header injection: a subject is one line.
  const subject = renderTemplate(subjectOverride || template.subject, vars).replace(/[\r\n]+/g, " ");
  const message = renderTemplate(bodyOverride || template.body, vars);

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
  await audit({
    user,
    businessId: access.businessId,
    action: "invoice.email",
    entityType: "invoice",
    entityId: id,
    summary: `Emailed ${invoice.invoiceNumber} to ${to}`,
    req,
  });

  return NextResponse.json({ ok: true, to });
});
