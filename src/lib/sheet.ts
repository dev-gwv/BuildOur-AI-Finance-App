import { prisma } from "./prisma";
import { sheetTarget } from "@/server/businesses";
import { expenseSheetBody, paymentReceiptRow, type SheetBody } from "./sheetRows";
import { computeInvoice } from "./invoiceLines";

export type { SheetBody };

/**
 * Mirrors the app's money into the Google Sheet each business keeps, through
 * the Apps Script web app behind every workbook (google-apps-script/PaymentSync.gs).
 * Each business has its own sheet URL and secret, set in Settings -> Businesses
 * (see sheetTarget in src/server/businesses.ts).
 *
 * Writes are upserts keyed on the record's id (kept in a column off to the
 * side), so an edit rewrites the same row, a date change moves it to the right
 * month, and a retried write can never add a duplicate.
 *
 * Nothing here throws. The record is already saved by the time this runs, and
 * an unreachable sheet must not make it look like it wasn't. Failures are
 * stored in SheetSyncFailure to be shown and retried.
 */

/** Sends one write. Returns whether the sheet accepted it (false when not configured, too). */
export async function postToSheet(businessId: string, body: SheetBody): Promise<boolean> {
  const target = await sheetTarget(businessId).catch(() => null);
  if (!target) return false;
  const { url, secret } = target;

  let error: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, ...body }),
    });
    // Apps Script answers 200 with an error payload as readily as it fails outright.
    const text = await res.text();
    if (!res.ok || text.includes('"ok":false')) error = `${res.status} ${text.slice(0, 300)}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  try {
    if (error) {
      console.error(`Sheet sync (business ${businessId}) failed for ${body.action} ${body.id}: ${error}`);
      const open = await prisma.sheetSyncFailure.findFirst({
        where: { businessId, recordId: body.id, resolvedAt: null },
      });
      if (open) {
        await prisma.sheetSyncFailure.update({
          where: { id: open.id },
          data: { action: body.action, payload: body, error, attempts: { increment: 1 } },
        });
      } else {
        await prisma.sheetSyncFailure.create({
          data: { businessId, action: body.action, recordId: body.id, payload: body, error },
        });
      }
    } else {
      // The latest write for this record landed, so anything still pending for it is moot.
      await prisma.sheetSyncFailure.updateMany({
        where: { businessId, recordId: body.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }
  } catch (e) {
    console.error("Couldn't record the sheet sync outcome:", e);
  }
  return !error;
}

// --- What callers use -------------------------------------------------------
// Each reads the record's current state, so calling one after any change —
// create, edit, or a retry — always converges the sheet on the database.

const paymentSelect = {
  id: true,
  amount: true,
  paidOn: true,
  method: true,
  note: true,
  gateway: true,
  feeAmount: true,
  feeGstAmount: true,
  kind: true,
  tdsAmount: true,
  tdsSection: true,
  invoice: {
    select: {
      businessId: true,
      brand: true,
      customerName: true,
      invoiceNumber: true,
      gstPercent: true,
      lines: { select: { grossAmount: true, gstPercent: true, hsnSac: true, description: true, qty: true } },
    },
  },
} as const;

/** The invoice fields a sheet row needs, with the taxable share worked out from its lines. */
function sheetInvoice(inv: {
  brand: string;
  customerName: string;
  invoiceNumber: string;
  gstPercent: number;
  lines: { grossAmount: number; gstPercent: number; hsnSac: string; description: string; qty: number }[];
}) {
  if (!inv.lines.length) return inv;
  const totals = computeInvoice(inv.lines, { isInterState: false, gstRegistered: inv.brand === "GRATEFUL" });
  return { ...inv, taxableRatio: totals.total > 0 ? totals.subTotal / totals.total : null };
}

/** Writes (or rewrites) a payment's row in its invoice's workbook. */
export async function syncPayment(paymentId: string): Promise<void> {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
    if (!payment) return;
    await postToSheet(payment.invoice.businessId, { action: "upsert", ...paymentReceiptRow(payment, sheetInvoice(payment.invoice)) });
  } catch (e) {
    console.error(`Sheet sync for payment ${paymentId} failed before sending:`, e);
  }
}

/** Rewrites every payment row of an invoice — after its customer or number changed. */
export async function syncInvoicePayments(invoiceId: string): Promise<void> {
  try {
    const payments = await prisma.payment.findMany({ where: { invoiceId }, select: paymentSelect });
    for (const p of payments) {
      await postToSheet(p.invoice.businessId, { action: "upsert", ...paymentReceiptRow(p, sheetInvoice(p.invoice)) });
    }
  } catch (e) {
    console.error(`Sheet sync for invoice ${invoiceId} failed before sending:`, e);
  }
}

export async function unsyncPayment(businessId: string, paymentId: string): Promise<void> {
  await postToSheet(businessId, { action: "remove", id: paymentId });
}

/**
 * Writes an entry's row. `previous` is where it was before an edit: if the
 * business or direction changed, the old row is cleared first so it isn't left behind.
 */
export async function syncExpense(
  expenseId: string,
  previous?: { businessId: string; direction: string }
): Promise<void> {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: { category: { select: { name: true } }, gateway: { select: { name: true } } },
    });
    if (!expense) return;
    if (previous && (previous.businessId !== expense.businessId || previous.direction !== expense.direction)) {
      await unsyncExpense(previous.businessId, previous.direction, expenseId);
    }
    await postToSheet(expense.businessId, expenseSheetBody(expense));
  } catch (e) {
    console.error(`Sheet sync for expense ${expenseId} failed before sending:`, e);
  }
}

export async function unsyncExpense(businessId: string, direction: string, expenseId: string): Promise<void> {
  await postToSheet(businessId, direction === "OUT" ? { action: "removeExpense", id: expenseId } : { action: "remove", id: expenseId });
}

/** Re-sends a stored failed write. Upserts are idempotent, so this is always safe. */
export async function retrySheetFailure(failureId: string): Promise<boolean> {
  const failure = await prisma.sheetSyncFailure.findUnique({ where: { id: failureId } });
  if (!failure || failure.resolvedAt) return true;
  return postToSheet(failure.businessId, failure.payload as SheetBody);
}
