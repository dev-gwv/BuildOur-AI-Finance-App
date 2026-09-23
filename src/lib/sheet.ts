import { prisma } from "./prisma";
import { LEDGERS, ledgerForInvoice, parseLedger, type LedgerKey } from "./ventures";
import { expenseSheetBody, paymentReceiptRow, type SheetBody } from "./sheetRows";

export type { SheetBody };

/**
 * Mirrors the app's money into the Google Sheets each business keeps, through
 * the Apps Script web app behind every workbook (google-apps-script/PaymentSync.gs).
 * Each workbook has its own copy of the script, so its own URL and secret — see
 * LEDGERS in src/lib/ventures.ts for the variable names.
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
export async function postToSheet(ledger: LedgerKey, body: SheetBody): Promise<boolean> {
  const url = process.env[LEDGERS[ledger].sheetEnvUrl];
  const secret = process.env[LEDGERS[ledger].sheetEnvSecret];
  if (!url || !secret) return false;

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
      console.error(`${ledger} sheet sync failed for ${body.action} ${body.id}: ${error}`);
      const open = await prisma.sheetSyncFailure.findFirst({
        where: { ledger, recordId: body.id, resolvedAt: null },
      });
      if (open) {
        await prisma.sheetSyncFailure.update({
          where: { id: open.id },
          data: { action: body.action, payload: body, error, attempts: { increment: 1 } },
        });
      } else {
        await prisma.sheetSyncFailure.create({
          data: { ledger, action: body.action, recordId: body.id, payload: body, error },
        });
      }
    } else {
      // The latest write for this record landed, so anything still pending for it is moot.
      await prisma.sheetSyncFailure.updateMany({
        where: { ledger, recordId: body.id, resolvedAt: null },
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
  invoice: { select: { brand: true, venture: true, customerName: true, invoiceNumber: true, gstPercent: true } },
} as const;

/** Writes (or rewrites) a payment's row in its invoice's workbook. */
export async function syncPayment(paymentId: string): Promise<void> {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
    if (!payment) return;
    const ledger = ledgerForInvoice(payment.invoice);
    if (ledger) await postToSheet(ledger, { action: "upsert", ...paymentReceiptRow(payment, payment.invoice) });
  } catch (e) {
    console.error(`Sheet sync for payment ${paymentId} failed before sending:`, e);
  }
}

/** Rewrites every payment row of an invoice — after its customer or number changed. */
export async function syncInvoicePayments(invoiceId: string): Promise<void> {
  try {
    const payments = await prisma.payment.findMany({ where: { invoiceId }, select: paymentSelect });
    for (const p of payments) {
      const ledger = ledgerForInvoice(p.invoice);
      if (ledger) await postToSheet(ledger, { action: "upsert", ...paymentReceiptRow(p, p.invoice) });
    }
  } catch (e) {
    console.error(`Sheet sync for invoice ${invoiceId} failed before sending:`, e);
  }
}

export async function unsyncPayment(ledger: LedgerKey | null, paymentId: string): Promise<void> {
  if (ledger) await postToSheet(ledger, { action: "remove", id: paymentId });
}

/**
 * Writes an expense's row. `previous` is where it was before an edit: if the
 * venture or direction changed, the old row is cleared first so it isn't left behind.
 */
export async function syncExpense(
  expenseId: string,
  previous?: { venture: string | null; direction: string }
): Promise<void> {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: { category: { select: { name: true } }, gateway: { select: { name: true } } },
    });
    if (!expense) return;
    const ledger = parseLedger(expense.venture);
    const oldLedger = previous ? parseLedger(previous.venture) : null;
    if (previous && oldLedger && (oldLedger !== ledger || previous.direction !== expense.direction)) {
      await unsyncExpense(oldLedger, previous.direction, expenseId);
    }
    if (ledger) await postToSheet(ledger, expenseSheetBody(expense));
  } catch (e) {
    console.error(`Sheet sync for expense ${expenseId} failed before sending:`, e);
  }
}

export async function unsyncExpense(ledger: LedgerKey | null, direction: string, expenseId: string): Promise<void> {
  if (!ledger) return;
  await postToSheet(ledger, direction === "OUT" ? { action: "removeExpense", id: expenseId } : { action: "remove", id: expenseId });
}

/** Re-sends a stored failed write. Upserts are idempotent, so this is always safe. */
export async function retrySheetFailure(failureId: string): Promise<boolean> {
  const failure = await prisma.sheetSyncFailure.findUnique({ where: { id: failureId } });
  if (!failure || failure.resolvedAt) return true;
  const ledger = parseLedger(failure.ledger);
  if (!ledger) return false;
  return postToSheet(ledger, failure.payload as SheetBody);
}
