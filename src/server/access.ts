import { prisma } from "@/lib/prisma";
import { forbidden, notFound } from "./errors";
import { isAdmin, type SessionUser } from "./session";

/**
 * Who can see what. Admins see every business; members only the businesses
 * they're assigned to — for invoices, payments, entries, files and reports
 * alike. Every query and every write goes through these checks.
 */

export type BusinessAccess = "ALL" | string[];

export async function accessibleBusinessIds(user: SessionUser): Promise<BusinessAccess> {
  if (isAdmin(user)) return "ALL";
  const rows = await prisma.businessMember.findMany({ where: { userId: user.id }, select: { businessId: true } });
  return rows.map((r) => r.businessId);
}

export async function canAccessBusiness(user: SessionUser, businessId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const row = await prisma.businessMember.findUnique({
    where: { userId_businessId: { userId: user.id, businessId } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function assertBusinessAccess(user: SessionUser, businessId: string): Promise<void> {
  if (!(await canAccessBusiness(user, businessId))) throw forbidden("You don't have access to this business");
}

/** A Prisma `where` fragment limiting rows to the businesses the user can see. */
export function accessWhere(access: BusinessAccess): { businessId?: { in: string[] } } {
  return access === "ALL" ? {} : { businessId: { in: access } };
}

/** Loads an invoice the user may act on, or throws 404/403. */
export async function requireInvoiceAccess(user: SessionUser, invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, businessId: true, brand: true, invoiceNumber: true },
  });
  if (!invoice) throw notFound("That invoice");
  await assertBusinessAccess(user, invoice.businessId);
  return invoice;
}

/** Loads a payment the user may act on (through its invoice), or throws 404/403. */
export async function requirePaymentAccess(user: SessionUser, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, invoiceId: true, invoice: { select: { businessId: true, invoiceNumber: true } } },
  });
  if (!payment) throw notFound("That payment");
  await assertBusinessAccess(user, payment.invoice.businessId);
  return payment;
}

/** Loads an entry (money in/out) the user may act on, or throws 404/403. */
export async function requireEntryAccess(user: SessionUser, entryId: string) {
  const entry = await prisma.expense.findUnique({ where: { id: entryId } });
  if (!entry) throw notFound("That entry");
  await assertBusinessAccess(user, entry.businessId);
  return entry;
}
