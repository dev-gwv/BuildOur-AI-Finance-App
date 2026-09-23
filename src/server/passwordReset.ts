import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { audit } from "./audit";
import { badRequest } from "./errors";
import { LIMITS, clientIp, hit } from "./rateLimit";

/**
 * Self-service password reset by emailed link.
 *
 * - The link carries a random 32-byte token; only its SHA-256 is stored, so a
 *   database leak doesn't hand out working links.
 * - One link at a time per person, valid for 30 minutes, usable once.
 * - The request answers the same whether or not the email has an account, so
 *   the form can't be used to find out who works here.
 * - Resetting ends every existing session (sessionVersion bump).
 */

const VALID_FOR_MS = 30 * 60 * 1000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * The app's own address for links in emails. Never taken from the request's
 * Host header, which a caller controls: a forged host would mail a victim a
 * working reset link pointing at someone else's site.
 */
function appOrigin(): string | null {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3100";
}

export function resetByEmailAvailable(): boolean {
  return isMailConfigured() && appOrigin() !== null;
}

export async function requestPasswordReset(emailInput: string, req: Request): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  // Counted before any lookup, so the limit applies equally to real and unknown addresses.
  const [perEmail, perIp] = await Promise.all([
    hit(`reset:${email}`, 3, 60 * 60),
    hit(`reset-ip:${clientIp(req.headers)}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window),
  ]);
  if (!perEmail.ok || !perIp.ok || !resetByEmailAvailable()) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, active: true } });
  if (!user || !user.active) return;

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: { tokenHash: hash(token), userId: user.id, expiresAt: new Date(Date.now() + VALID_FOR_MS) },
    }),
  ]);

  const link = `${appOrigin()}/reset-password?token=${token}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Reset your Grateful Finance password",
      text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your Grateful Finance password. Open this link within 30 minutes to choose a new one:\n\n${link}\n\nIf it wasn't you, ignore this email — your password stays the same.`,
      html: `<p>Hi ${escapeHtml(user.name)},</p><p>Someone (hopefully you) asked to reset your Grateful Finance password. This link works once, for the next 30 minutes:</p><p><a href="${link}">Choose a new password</a></p><p>If it wasn't you, ignore this email — your password stays the same.</p>`,
      fromName: "Grateful Finance",
    });
    await audit({ user: null, action: "user.password_reset_requested", entityType: "user", entityId: user.id, summary: `Password reset link sent to ${user.email}`, req });
  } catch (e) {
    // Logged, not shown: the response must not differ for real accounts.
    console.error("Couldn't send the password reset email:", e);
  }
}

export type TokenState = "valid" | "invalid" | "expired" | "used";

export async function checkResetToken(token: string | undefined | null): Promise<TokenState> {
  if (!token || token.length < 20 || token.length > 200) return "invalid";
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!row) return "invalid";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() < Date.now()) return "expired";
  return "valid";
}

export async function completePasswordReset(token: string, newPassword: string, req: Request): Promise<void> {
  const ip = await hit(`reset-confirm-ip:${clientIp(req.headers)}`, 20, 15 * 60);
  if (!ip.ok) throw badRequest("Too many attempts. Please wait a few minutes and try again.");

  const state = await checkResetToken(token);
  if (state !== "valid") {
    throw badRequest(
      state === "expired" ? "This link has expired. Ask for a new one." : state === "used" ? "This link has already been used. Ask for a new one." : "This link isn't valid. Ask for a new one."
    );
  }
  const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hash(token) }, select: { userId: true } });
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.$transaction(async (tx) => {
    // Claim the token first: of two simultaneous uses, only one gets it.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hash(token), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw badRequest("This link has already been used. Ask for a new one.");
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId, tokenHash: { not: hash(token) } } });
  });
  await audit({ user: null, action: "user.password_reset", entityType: "user", entityId: row.userId, summary: "Password reset by emailed link; other sessions signed out", req });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
