import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, badRequest, withApiErrors } from "@/server/errors";
import { isAdmin, requireUser } from "@/server/session";
import { requireInvoiceAccess } from "@/server/access";
import { enforce } from "@/server/rateLimit";
import { audit } from "@/server/audit";
import { BRANDS } from "@/lib/brands";
import { invoiceEmailHtml, invoiceEmailText } from "@/lib/invoiceEmail";
import { sendMail } from "@/lib/mailer";
import { describeSender, senderForBusiness } from "@/server/mailAccounts";
import { renderTemplate, templateVars } from "@/lib/emailTemplate";
import { templateFor } from "@/lib/templateStore";
import { invoiceBalance } from "@/lib/invoiceLines";
import { saveGeneratedPdf } from "@/lib/pdfStorage";
import { deleteUpload } from "@/lib/storage";
import { loadInvoicePdfData, pdfFileName, renderInvoicePdf } from "@/components/pdf/renderInvoicePdf";

type Params = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The draft shown in the compose box: template wording with placeholders filled. */
export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const access = await requireInvoiceAccess(user, id);

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: { select: { amount: true, kind: true, tdsAmount: true } },
      creditNotes: { select: { grossAmount: true } },
    },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const balance = invoiceBalance(invoice);
  const template = await templateFor(invoice.brand);
  const vars = templateVars({
    brand: invoice.brand,
    customerName: invoice.customerName,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    total: invoice.grossAmount,
    balanceDue: balance.balance,
    itemDescription: invoice.itemDescription,
  });
  const sender = await senderForBusiness(access.businessId);

  return NextResponse.json({
    to: invoice.customerEmail ?? "",
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
    configured: sender !== null,
    // Which mailbox it goes from (set per business), so nobody has to guess.
    sender: describeSender(sender),
    // Admins may send a one-off from another saved mailbox.
    mailboxes: isAdmin(user)
      ? await prisma.mailAccount.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true, label: true, email: true } })
      : [],
    // The dialog tells the sender what goes out with the message.
    attachment: pdfFileName(invoice.invoiceNumber),
    cancelled: invoice.status === "CANCELLED",
  });
});

export const POST = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const access = await requireInvoiceAccess(user, id);
  // A leaked session mustn't be able to use the business's mail account to spam.
  await enforce("emailPerUser", user.id);

  const form = await req.formData().catch(() => null);
  // Only admins may send from a mailbox other than the business's own.
  const requestedMailbox = form?.get("fromAccountId") ? String(form.get("fromAccountId")) : null;
  const sender = await senderForBusiness(access.businessId, isAdmin(user) ? requestedMailbox : null);
  if (!sender) {
    throw new ApiError(
      400,
      "No mailbox is set up to send from yet. An admin can add one in Settings → Integrations → Email."
    );
  }

  const override = form?.get("to") ? String(form.get("to")).trim().slice(0, 254) : "";
  const subjectOverride = form?.get("subject") ? String(form.get("subject")).slice(0, 300) : "";
  const bodyOverride = form?.get("body") ? String(form.get("body")).slice(0, 20_000) : "";

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: { select: { amount: true, kind: true, tdsAmount: true } },
      creditNotes: { select: { grossAmount: true } },
    },
  });
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const to = override || invoice.customerEmail || "";
  if (!EMAIL_RE.test(to)) throw badRequest("Add a valid customer email address before sending", { to: "Not a valid email" });

  const brand = BRANDS[invoice.brand];
  const balance = invoiceBalance(invoice);
  const amountPaid = Math.round((balance.received - balance.refunded) * 100) / 100;

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
    balanceDue: balance.balance,
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

  // The customer gets the actual tax invoice, not just a summary of it.
  const pdfData = await loadInvoicePdfData(id);
  if (!pdfData) throw new ApiError(404, "Invoice not found");
  const pdf = await renderInvoicePdf(pdfData);
  const filename = pdfFileName(invoice.invoiceNumber);

  await sendMail(sender, {
    to,
    fromName: brand.name,
    subject,
    text: invoiceEmailText(data),
    html: invoiceEmailHtml(data),
    attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
  });

  // Keep the exact PDF that went out, so there's a record of what the
  // customer received even if the invoice is edited later. The email has
  // already gone, so a storage hiccup only costs the copy, not the send.
  let emailedPdfPath: string | null = null;
  try {
    emailedPdfPath = await saveGeneratedPdf(pdf);
  } catch (e) {
    console.error(`Sent ${invoice.invoiceNumber}, but couldn't keep a copy of the PDF:`, e);
  }

  // Remember the address so the next send doesn't have to be retyped.
  await prisma.invoice.update({
    where: { id },
    data: { emailSentAt: new Date(), customerEmail: to, ...(emailedPdfPath ? { emailedPdfPath } : {}) },
  });
  if (emailedPdfPath && invoice.emailedPdfPath) await deleteUpload(invoice.emailedPdfPath).catch(() => {});
  await audit({
    user,
    businessId: access.businessId,
    action: "invoice.email",
    entityType: "invoice",
    entityId: id,
    summary: `Emailed ${invoice.invoiceNumber} to ${to} from ${sender.email} with ${filename} attached`,
    req,
  });

  return NextResponse.json({ ok: true, to, from: sender.email, attachment: filename, copyKept: Boolean(emailedPdfPath) });
});
