import nodemailer from "nodemailer";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Everything needed to send as one mailbox. Comes from a MailAccount saved in
 * Settings → Integrations (see src/server/mailAccounts.ts), or from the
 * SMTP_* environment settings used before mailboxes could be saved.
 */
export interface MailSender {
  /** MailAccount id, or null for the environment settings. */
  id: string | null;
  label: string;
  email: string;
  host: string;
  port: number;
  username: string;
  password: string;
  fromName: string | null;
  replyTo: string | null;
}

/** The SMTP_* environment settings as a sender, when they're complete. */
export function envSender(): MailSender | null {
  const host = process.env.SMTP_HOST;
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  if (!host || !username || !password) return null;
  const email = process.env.SMTP_FROM || username;
  return {
    id: null,
    label: "SMTP settings (Vercel)",
    email,
    host,
    port: Number(process.env.SMTP_PORT ?? 465),
    username,
    password,
    fromName: null,
    replyTo: null,
  };
}

function transportFor(sender: MailSender) {
  return nodemailer.createTransport({
    host: sender.host,
    port: sender.port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: sender.port === 465,
    auth: { user: sender.username, pass: sender.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}

/**
 * Signs in to the mailbox without sending anything, to check the details
 * before they're saved. Resolves to null on success, or a message a person
 * can act on.
 */
export async function verifySender(sender: MailSender): Promise<string | null> {
  try {
    await transportFor(sender).verify();
    return null;
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/535|auth|credentials|username and password/i.test(text)) {
      return "The mail server rejected the sign-in. For Gmail/Google Workspace use an App Password (Google Account → Security → App passwords), not the normal password.";
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(text)) return `Couldn't find the mail server "${sender.host}". Check the server name.`;
    if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(text)) {
      return `Couldn't connect to ${sender.host}:${sender.port}. Check the server and port (465 for SSL, 587 for STARTTLS).`;
    }
    return `The mail server said: ${text.slice(0, 200)}`;
  }
}

/**
 * Sends one email as the given mailbox, so invoices arrive from the address
 * customers already correspond with — and replies land back in it.
 */
export async function sendMail(
  sender: MailSender,
  opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments?: MailAttachment[];
    replyTo?: string;
    fromName?: string;
  }
): Promise<void> {
  const name = (sender.fromName || opts.fromName || "").replace(/"/g, "");
  const from = name ? `"${name}" <${sender.email}>` : sender.email;

  await transportFor(sender).sendMail({
    from,
    to: opts.to,
    replyTo: opts.replyTo ?? sender.replyTo ?? undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}
