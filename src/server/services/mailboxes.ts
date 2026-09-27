import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { openSecret, sealSecret } from "@/lib/secretBox";
import { verifySender, type MailSender } from "@/lib/mailer";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../errors";
import type { SessionUser } from "../session";
import { requiredText } from "../validation";
import { guardWrite } from "./common";

// Mailboxes the app sends through. Admin only. A mailbox is only saved (and
// only re-saved with new sign-in details) after a live test sign-in works, so
// a typo can't leave invoices silently unsendable.

const emailAddress = z.string().trim().toLowerCase().email("That doesn't look like an email address").max(254);
const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "A mail server name like smtp.gmail.com")
  .max(253);
const port = z.coerce.number().int().refine((p) => [25, 465, 587, 2525].includes(p), "Use port 465 (SSL) or 587 (STARTTLS)");
const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === undefined ? undefined : v || null));
const optionalEmail = z
  .union([z.literal(""), emailAddress])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

export const createMailboxSchema = z.object({
  label: requiredText("Name", 60),
  email: emailAddress,
  host,
  port,
  /** Defaults to the email address. */
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1, "Paste the app password").max(500),
  fromName: optional(120),
  replyTo: optionalEmail,
  isDefault: z.boolean().optional(),
});

export const updateMailboxSchema = z.object({
  label: requiredText("Name", 60).optional(),
  email: emailAddress.optional(),
  host: host.optional(),
  port: port.optional(),
  username: z.string().trim().max(254).optional(),
  /** Write-only; leave out to keep the saved one. */
  password: z.string().max(500).optional(),
  fromName: optional(120),
  replyTo: optionalEmail,
  isDefault: z.literal(true).optional(),
});

async function verifyOrThrow(sender: MailSender) {
  const problem = await verifySender(sender);
  if (problem) throw badRequest(problem, { password: problem });
}

export async function createMailbox(admin: SessionUser, input: z.infer<typeof createMailboxSchema>, req: Request) {
  await guardWrite(admin);
  if (await prisma.mailAccount.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw conflict(`${input.email} is already added`);
  }
  const username = input.username?.trim() || input.email;
  await verifyOrThrow({
    id: null,
    label: input.label,
    email: input.email,
    host: input.host,
    port: input.port,
    username,
    password: input.password,
    fromName: input.fromName ?? null,
    replyTo: input.replyTo ?? null,
  });

  // The first mailbox is the default; asking for default moves it here.
  const isFirst = (await prisma.mailAccount.count()) === 0;
  const makeDefault = isFirst || Boolean(input.isDefault);
  const mailbox = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.mailAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.mailAccount.create({
      data: {
        label: input.label,
        email: input.email,
        host: input.host,
        port: input.port,
        username,
        secretEnc: sealSecret(input.password),
        fromName: input.fromName ?? null,
        replyTo: input.replyTo ?? null,
        isDefault: makeDefault,
        verifiedAt: new Date(),
      },
      select: { id: true, email: true },
    });
  });
  await audit({
    user: admin,
    action: "mailbox.create",
    entityType: "mailbox",
    entityId: mailbox.id,
    summary: `Added mailbox ${mailbox.email}${makeDefault ? " (default)" : ""}`,
    req,
  });
  return mailbox;
}

export async function updateMailbox(admin: SessionUser, id: string, input: z.infer<typeof updateMailboxSchema>, req: Request) {
  await guardWrite(admin);
  const existing = await prisma.mailAccount.findUnique({ where: { id } });
  if (!existing) throw notFound("That mailbox");
  if (input.email && input.email !== existing.email && (await prisma.mailAccount.findUnique({ where: { email: input.email }, select: { id: true } }))) {
    throw conflict(`${input.email} is already added`);
  }

  // New sign-in details must work before they replace the old ones.
  const signInChanged =
    (input.password && input.password.length > 0) ||
    (input.host !== undefined && input.host !== existing.host) ||
    (input.port !== undefined && input.port !== existing.port) ||
    (input.username !== undefined && (input.username || input.email || existing.email) !== existing.username) ||
    (input.email !== undefined && input.email !== existing.email);
  const password = input.password || openSecret(existing.secretEnc);
  if (signInChanged) {
    if (!password) throw badRequest("Paste the app password again — the saved one can't be read", { password: "Required" });
    await verifyOrThrow({
      id,
      label: input.label ?? existing.label,
      email: input.email ?? existing.email,
      host: input.host ?? existing.host,
      port: input.port ?? existing.port,
      username: input.username || input.email || existing.username,
      password,
      fromName: null,
      replyTo: null,
    });
  }

  const mailbox = await prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.mailAccount.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
    return tx.mailAccount.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.host !== undefined ? { host: input.host } : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(input.username !== undefined || input.email !== undefined ? { username: input.username || input.email || existing.username } : {}),
        ...(input.password ? { secretEnc: sealSecret(input.password) } : {}),
        ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
        ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
        ...(input.isDefault ? { isDefault: true } : {}),
        ...(signInChanged ? { verifiedAt: new Date() } : {}),
      },
      select: { id: true, email: true },
    });
  });
  const notes = [
    signInChanged ? "sign-in details updated" : null,
    input.isDefault && !existing.isDefault ? "made default" : null,
    input.label && input.label !== existing.label ? `renamed to ${input.label}` : null,
    input.fromName !== undefined && input.fromName !== existing.fromName ? "sender name changed" : null,
    input.replyTo !== undefined && input.replyTo !== existing.replyTo ? "reply-to changed" : null,
  ].filter(Boolean);
  await audit({
    user: admin,
    action: "mailbox.update",
    entityType: "mailbox",
    entityId: id,
    summary: `Mailbox ${mailbox.email}: ${notes.join(", ") || "no changes"}`,
    req,
  });
  return mailbox;
}

export async function deleteMailbox(admin: SessionUser, id: string, req: Request) {
  await guardWrite(admin);
  const existing = await prisma.mailAccount.findUnique({
    where: { id },
    include: { businesses: { select: { name: true } } },
  });
  if (!existing) throw notFound("That mailbox");
  await prisma.$transaction(async (tx) => {
    // Businesses that used it fall back to the default (the FK sets them to null).
    await tx.mailAccount.delete({ where: { id } });
    if (existing.isDefault) {
      const next = await tx.mailAccount.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      if (next) await tx.mailAccount.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  await audit({
    user: admin,
    action: "mailbox.delete",
    entityType: "mailbox",
    entityId: id,
    summary: `Removed mailbox ${existing.email}${existing.businesses.length ? ` — ${existing.businesses.map((b) => b.name).join(", ")} now use the default` : ""}`,
    req,
  });
}

/** Signs in again with the saved details, without sending anything. */
export async function testMailbox(id: string): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.mailAccount.findUnique({ where: { id } });
  if (!row) throw notFound("That mailbox");
  const password = openSecret(row.secretEnc);
  if (!password) return { ok: false, error: "The saved app password can't be read (the app's AUTH_SECRET changed). Paste it again." };
  const problem = await verifySender({
    id,
    label: row.label,
    email: row.email,
    host: row.host,
    port: row.port,
    username: row.username,
    password,
    fromName: null,
    replyTo: null,
  });
  if (problem) return { ok: false, error: problem };
  await prisma.mailAccount.update({ where: { id }, data: { verifiedAt: new Date() } });
  return { ok: true };
}
