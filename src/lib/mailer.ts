import nodemailer from "nodemailer";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** True once SMTP is configured, so the UI can explain instead of failing silently. */
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function mailFromAddress(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "";
}

/**
 * Sends through the business's own mailbox over SMTP, so invoices arrive from
 * the same address customers already correspond with (e.g. Zoho Mail).
 * Credentials come from the environment and are never stored in the database.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  replyTo?: string;
  fromName?: string;
}): Promise<void> {
  if (!isMailConfigured()) {
    throw new Error(
      "Email isn't set up yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to the environment."
    );
  }

  const port = Number(process.env.SMTP_PORT ?? 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const from = opts.fromName
    ? `"${opts.fromName.replace(/"/g, "")}" <${mailFromAddress()}>`
    : mailFromAddress();

  await transporter.sendMail({
    from,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}
