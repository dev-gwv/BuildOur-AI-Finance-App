import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secretBox";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, conflict } from "./errors";
import {
  MAX_INVOICE_NUMBER_LENGTH,
  formatInvoiceNumber,
  hasFyToken,
  previewInvoiceNumber,
  resolvePrefix,
  seqInSeries,
} from "@/lib/invoiceNumbering";

export { formatInvoiceNumber, fyLabel, previewInvoiceNumber, resolvePrefix, seqInSeries, slugify } from "@/lib/invoiceNumbering";

/** What the UI needs to show and pick a business. */
export const businessSummarySelect = {
  id: true,
  name: true,
  slug: true,
  entity: true,
  color: true,
  invoicePrefix: true,
  invoiceNextNumber: true,
  invoiceDigits: true,
  creditNotePrefix: true,
  gstLockedThrough: true,
  defaultGstPercent: true,
  needsReview: true,
  archivedAt: true,
} as const;

export type BusinessSummary = Prisma.BusinessGetPayload<{ select: typeof businessSummarySelect }>;

/**
 * Takes the next number in a counter-table series (per financial year when
 * the prefix has {FY}), creating the series on first use from the highest
 * number already issued in it. One atomic statement, so concurrent issues
 * can't share a number.
 */
async function takeFromCounter(
  tx: Prisma.TransactionClient,
  businessId: string,
  series: string,
  highestIssued: () => Promise<number>
): Promise<number> {
  const exists = await tx.invoiceCounter.findUnique({ where: { businessId_series: { businessId, series } }, select: { next: true } });
  const seed = exists ? 0 : (await highestIssued()) + 1;
  const rows = await tx.$queryRaw<{ taken: number }[]>`
    INSERT INTO "InvoiceCounter" ("businessId", "series", "next") VALUES (${businessId}, ${series}, ${seed + 1})
    ON CONFLICT ("businessId", "series") DO UPDATE SET "next" = "InvoiceCounter"."next" + 1
    RETURNING ("next" - 1) AS taken`;
  return Number(rows[0].taken);
}

/** Highest sequence already used in a series, across the given numbers. */
function highestSeq(numbers: string[], series: string): number {
  return numbers.reduce((max, n) => Math.max(max, seqInSeries(n, series) ?? 0), 0);
}

/**
 * Reserves an invoice number inside the caller's transaction.
 *
 * - A prefix without {FY} uses the business's running counter (bumped in the
 *   same UPDATE that reads it, which row-locks it).
 * - A prefix with {FY} uses the financial year of the invoice date, each year
 *   its own series from 1.
 * - A number typed by hand is accepted if it's free; if it's in the series and
 *   ahead of the counter, the counter jumps past it.
 */
export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  businessId: string,
  requested?: string | null,
  invoiceDate: Date = new Date()
): Promise<string> {
  const business = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { invoicePrefix: true, invoiceNextNumber: true, invoiceDigits: true },
  });
  const fySeries = hasFyToken(business.invoicePrefix);
  const series = resolvePrefix(business.invoicePrefix, invoiceDate);

  if (requested) {
    const number = requested.trim();
    if (number.length > MAX_INVOICE_NUMBER_LENGTH) {
      throw badRequest(`An invoice number can be at most ${MAX_INVOICE_NUMBER_LENGTH} characters`, { invoiceNumber: "Too long for GST" });
    }
    if (await tx.invoice.findUnique({ where: { invoiceNumber: number }, select: { id: true } })) {
      throw conflict(`Invoice ${number} already exists`);
    }
    const seq = seqInSeries(number, series);
    if (seq !== null) {
      if (fySeries) {
        await tx.$executeRaw`
          INSERT INTO "InvoiceCounter" ("businessId", "series", "next") VALUES (${businessId}, ${series}, ${seq + 1})
          ON CONFLICT ("businessId", "series") DO UPDATE SET "next" = GREATEST("InvoiceCounter"."next", ${seq + 1})`;
      } else if (seq >= business.invoiceNextNumber) {
        await tx.business.update({ where: { id: businessId }, data: { invoiceNextNumber: seq + 1 } });
      }
    }
    return number;
  }

  // Skips any number already taken (e.g. one typed by hand earlier).
  for (let attempt = 0; attempt < 20; attempt++) {
    let seq: number;
    if (fySeries) {
      seq = await takeFromCounter(tx, businessId, series, async () => {
        const taken = await tx.invoice.findMany({ where: { businessId, invoiceNumber: { startsWith: series } }, select: { invoiceNumber: true } });
        return highestSeq(taken.map((t) => t.invoiceNumber), series);
      });
    } else {
      const b = await tx.business.update({
        where: { id: businessId },
        data: { invoiceNextNumber: { increment: 1 } },
        select: { invoiceNextNumber: true },
      });
      seq = b.invoiceNextNumber - 1;
    }
    const number = formatInvoiceNumber(series, seq, business.invoiceDigits);
    if (!(await tx.invoice.findUnique({ where: { invoiceNumber: number }, select: { id: true } }))) return number;
  }
  throw conflict("Couldn't find a free invoice number — check the business's series in Settings");
}

/** Reserves the next credit note number (its own series; {FY} works the same way). */
export async function allocateCreditNoteNumber(tx: Prisma.TransactionClient, businessId: string, noteDate: Date): Promise<string> {
  const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { creditNotePrefix: true, invoiceDigits: true } });
  const series = resolvePrefix(business.creditNotePrefix, noteDate);
  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = await takeFromCounter(tx, businessId, series, async () => {
      const taken = await tx.creditNote.findMany({ where: { businessId, number: { startsWith: series } }, select: { number: true } });
      return highestSeq(taken.map((t) => t.number), series);
    });
    const number = formatInvoiceNumber(series, seq, Math.min(business.invoiceDigits, 6));
    const clash =
      (await tx.creditNote.findUnique({ where: { number }, select: { id: true } })) ??
      (await tx.invoice.findUnique({ where: { invoiceNumber: number }, select: { id: true } }));
    if (!clash) return number;
  }
  throw conflict("Couldn't find a free credit note number — check the business's series in Settings");
}

/** What the next invoice will be numbered (for forms), reading the FY counter when the prefix has {FY}. */
export async function nextInvoiceNumberPreview(business: BusinessSummary, date: Date = new Date()): Promise<string> {
  if (!hasFyToken(business.invoicePrefix)) return previewInvoiceNumber(business);
  const series = resolvePrefix(business.invoicePrefix, date);
  const counter = await prisma.invoiceCounter.findUnique({ where: { businessId_series: { businessId: business.id, series } }, select: { next: true } });
  let next = counter?.next;
  if (!next) {
    const taken = await prisma.invoice.findMany({ where: { businessId: business.id, invoiceNumber: { startsWith: series } }, select: { invoiceNumber: true } });
    next = highestSeq(taken.map((t) => t.invoiceNumber), series) + 1;
  }
  return previewInvoiceNumber(business, { date, fyNext: next });
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

