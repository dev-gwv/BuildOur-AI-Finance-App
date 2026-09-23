import { prisma } from "@/lib/prisma";
import { conflict } from "./errors";

/**
 * Once a month's GST returns are filed, the invoices, credit notes and
 * entries in it are part of a return and must not change. An admin records
 * that in Settings → Businesses ("GST filed through"). Anything dated on or
 * before that day can't be added, edited, cancelled or deleted — mistakes
 * found later are corrected with a credit note in the current period.
 */

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function lockedThrough(businessId: string): Promise<Date | null> {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { gstLockedThrough: true } });
  return b?.gstLockedThrough ?? null;
}

/** Whether a date falls in a filed (locked) period. Dates are calendar days at midnight UTC. */
export function isLocked(lock: Date | null, date: Date): boolean {
  return Boolean(lock && date.getTime() <= lock.getTime());
}

/**
 * Throws a 409 if any of the dates is in a filed period. Pass both the old
 * and the new date when editing, so a record can't be moved into or out of one.
 */
export async function assertPeriodOpen(businessId: string, dates: (Date | null | undefined)[], what = "This record"): Promise<void> {
  const lock = await lockedThrough(businessId);
  if (!lock) return;
  if (dates.some((d) => d && isLocked(lock, d))) {
    throw conflict(
      `${what} is in a period whose GST is already filed (through ${fmt(lock)}). Correct it with a credit note dated today instead.`
    );
  }
}
