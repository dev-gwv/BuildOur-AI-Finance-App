import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import { envSender, type MailSender } from "@/lib/mailer";

/**
 * Which mailbox an email goes out from.
 *
 * Invoices: the business's chosen mailbox (Settings → Businesses), else the
 * default mailbox, else the SMTP_* environment settings. An admin may pick a
 * different saved mailbox for a single send. System email (password resets)
 * always uses the default.
 */

type AccountRow = {
  id: string;
  label: string;
  email: string;
  host: string;
  port: number;
  username: string;
  secretEnc: string;
  fromName: string | null;
  replyTo: string | null;
};

function toSender(row: AccountRow): MailSender | null {
  const password = openSecret(row.secretEnc);
  // Unreadable after an AUTH_SECRET change: treat as not set up.
  if (!password) return null;
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    host: row.host,
    port: row.port,
    username: row.username,
    password,
    fromName: row.fromName,
    replyTo: row.replyTo,
  };
}

export async function defaultSender(): Promise<MailSender | null> {
  const row =
    (await prisma.mailAccount.findFirst({ where: { isDefault: true } })) ??
    (await prisma.mailAccount.findFirst({ orderBy: { createdAt: "asc" } }));
  return (row && toSender(row)) ?? envSender();
}

export async function senderForBusiness(businessId: string, overrideAccountId?: string | null): Promise<MailSender | null> {
  if (overrideAccountId) {
    const row = await prisma.mailAccount.findUnique({ where: { id: overrideAccountId } });
    const sender = row && toSender(row);
    if (sender) return sender;
  }
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { mailAccount: true },
  });
  return (business?.mailAccount && toSender(business.mailAccount)) ?? defaultSender();
}

/** True when any mailbox (saved or environment) can send. */
export async function mailAvailable(): Promise<boolean> {
  return (await defaultSender()) !== null;
}

/** What the UI may know about a mailbox: never the password. */
export type MailAccountSummary = {
  id: string;
  label: string;
  email: string;
  host: string;
  port: number;
  username: string;
  fromName: string | null;
  replyTo: string | null;
  isDefault: boolean;
  verifiedAt: string | null;
  businesses: { id: string; name: string; color: string }[];
};

export async function listMailAccounts(): Promise<MailAccountSummary[]> {
  const rows = await prisma.mailAccount.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { businesses: { where: { archivedAt: null }, select: { id: true, name: true, color: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    email: r.email,
    host: r.host,
    port: r.port,
    username: r.username,
    fromName: r.fromName,
    replyTo: r.replyTo,
    isDefault: r.isDefault,
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    businesses: r.businesses,
  }));
}

/** The sender as shown to a person: address and where it comes from. */
export function describeSender(sender: MailSender | null): { id: string | null; label: string; email: string } | null {
  return sender ? { id: sender.id, label: sender.label, email: sender.email } : null;
}
