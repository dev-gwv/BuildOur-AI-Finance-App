import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import type { Prisma } from "@/generated/prisma/client";
import { conflict } from "./errors";
import { formatInvoiceNumber, seqInSeries } from "@/lib/invoiceNumbering";

export { formatInvoiceNumber, previewInvoiceNumber, seqInSeries, slugify } from "@/lib/invoiceNumbering";

/** What the UI needs to show and pick a business. */
export const businessSummarySelect = {
  id: true,
  name: true,
  slug: true,
  entity: true,
  color: true,
  invoicePrefix: true,
  invoiceNextNumber: true,
  defaultGstPercent: true,
  needsReview: true,
  archivedAt: true,
} as const;

export type BusinessSummary = Prisma.BusinessGetPayload<{ select: typeof businessSummarySelect }>;

/**
 * Reserves an invoice number inside the caller's transaction. Taking the
 * number bumps the business's counter in the same UPDATE, which row-locks it,
 * so two people raising invoices at once can't be handed the same number.
 *
 * A number typed by hand is accepted if it's free; if it's in this business's
 * series and ahead of the counter, the counter jumps past it.
 */
export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  businessId: string,
  requested?: string | null
): Promise<string> {
  if (requested) {
    const number = requested.trim();
    if (await tx.invoice.findUnique({ where: { invoiceNumber: number }, select: { id: true } })) {
      throw conflict(`Invoice ${number} already exists`);
    }
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { invoicePrefix: true, invoiceNextNumber: true } });
    const seq = seqInSeries(number, business.invoicePrefix);
    if (seq !== null && seq >= business.invoiceNextNumber) {
      await tx.business.update({ where: { id: businessId }, data: { invoiceNextNumber: seq + 1 } });
    }
    return number;
  }

  // Skips any number already taken (e.g. one typed by hand earlier).
  for (let attempt = 0; attempt < 20; attempt++) {
    const b = await tx.business.update({
      where: { id: businessId },
      data: { invoiceNextNumber: { increment: 1 } },
      select: { invoicePrefix: true, invoiceNextNumber: true },
    });
    const number = formatInvoiceNumber(b.invoicePrefix, b.invoiceNextNumber - 1);
    if (!(await tx.invoice.findUnique({ where: { invoiceNumber: number }, select: { id: true } }))) return number;
  }
  throw conflict("Couldn't find a free invoice number — check the business's series in Settings");
}

/**
 * Where a business's Google Sheet lives. Set in Settings → Businesses; the
 * environment variables used before that existed still work as a fallback,
 * so the live Mulberry sync keeps running through the upgrade.
 */
export async function sheetTarget(businessId: string): Promise<{ url: string; secret: string } | null> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true, sheetUrl: true, sheetSecretEnc: true },
  });
  if (!b) return null;
  if (b.sheetUrl && b.sheetSecretEnc) {
    const secret = openSecret(b.sheetSecretEnc);
    return secret ? { url: b.sheetUrl, secret } : null;
  }
  const legacy: Record<string, [string, string]> = {
    mulberry: ["SHEETS_WEBHOOK_URL", "SHEETS_WEBHOOK_SECRET"],
    ipc: ["SHEETS_WEBHOOK_URL_IPC", "SHEETS_WEBHOOK_SECRET_IPC"],
    iwc: ["SHEETS_WEBHOOK_URL_IWC", "SHEETS_WEBHOOK_SECRET_IWC"],
  };
  const env = legacy[b.slug];
  const url = env && process.env[env[0]];
  const secret = env && process.env[env[1]];
  return url && secret ? { url, secret } : null;
}

/** Whether a business has a sheet connected, and from where — for Settings. */
export function sheetSource(b: { slug: string; sheetUrl: string | null; sheetSecretEnc: string | null }): "settings" | "environment" | null {
  if (b.sheetUrl && b.sheetSecretEnc) return "settings";
  const legacy: Record<string, string> = { mulberry: "SHEETS_WEBHOOK_URL", ipc: "SHEETS_WEBHOOK_URL_IPC", iwc: "SHEETS_WEBHOOK_URL_IWC" };
  return legacy[b.slug] && process.env[legacy[b.slug]] ? "environment" : null;
}

