import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { syncInvoicePayments, syncPayment, unsyncPayment } from "@/lib/sheet";
import { accessibleBusinessIds, accessWhere, assertBusinessAccess, requireInvoiceAccess } from "../access";
import { audit, diff } from "../audit";
import { allocateInvoiceNumber, formatInvoiceNumber, previewInvoiceNumber, seqInSeries } from "../businesses";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors";
import { isAdmin, type SessionUser } from "../session";
import {
  email,
  gstin,
  id,
  isoDate,
  money,
  optionalText,
  percent,
  positiveMoney,
  requiredText,
} from "../validation";
import { guardWrite, round2, rupees } from "./common";

/** Method recorded on the payment a Bajaj DO invoice gets when it's raised. */
export const BAJAJ_DISBURSEMENT = "Bajaj Finance disbursement";

/** Files the server accepts directly; larger quotation decks go straight to Blob. */
const MAX_DIRECT_UPLOAD = 4 * 1024 * 1024;
const UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const STORED_NAME = /^[a-zA-Z0-9-]+\.[a-zA-Z0-9]{1,5}$/;

/**
 * A cleared field arrives as "" from the JSON edit form; that means "not
 * given", not an invalid email or GSTIN. (Form uploads already drop blanks.)
 */
const blankAsMissing = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);

const invoiceFields = {
  invoiceDate: isoDate("Invoice date"),
  dueDate: isoDate("Due date").optional(),
  customerName: requiredText("Customer name", 200),
  // Required on a tax invoice (checked per entity below); a Mulberry quotation
  // names the couple but not their address, so there it may be left blank.
  customerAddress: z.string().trim().max(1000, "Customer address is too long").default(""),
  customerEmail: blankAsMissing(email),
  customerGstin: blankAsMissing(gstin),
  // Mulberry's quotation invoices have no place of supply or HSN.
  placeOfSupply: z.string().trim().max(100).default(""),
  itemDescription: requiredText("Item", 500),
  hsnSac: z.string().trim().max(20).default(""),
  qty: z.coerce.number({ error: "Quantity must be a number" }).positive("Quantity must be more than zero").max(100_000).default(1),
  grossAmount: positiveMoney("Amount"),
  gstPercent: percent("GST %").default(18),
  notes: optionalText(2000),
  terms: optionalText(5000),
};

export const createInvoiceSchema = z.object({
  businessId: id,
  /** Omitted (or the suggested next number) = take the next in the series. */
  invoiceNumber: z.string().trim().max(40).optional(),
  ...invoiceFields,
  doId: optionalText(40),
  doDate: isoDate("DO date").optional(),
  /** A file already sent straight to storage from the browser. */
  doFilePath: z.string().regex(STORED_NAME, "Invalid file reference").optional(),
  source: z.enum(["DO", "GST", "QUOTATION"]).optional(),
  advancePaid: money("Advance").default(0),
});

export const updateInvoiceSchema = z.object({
  invoiceNumber: requiredText("Invoice number", 40),
  ...invoiceFields,
  /** Move to another business of the same legal entity (admins only). */
  businessId: id.optional(),
});

/** A GST tax invoice must name the buyer's address; Mulberry's plain invoice needn't. */
function requireAddressForTaxInvoice(isMulberry: boolean, address: string) {
  if (!isMulberry && !address) {
    throw badRequest("Customer address is required on a tax invoice", { customerAddress: "Customer address is required" });
  }
}

async function storeUpload(file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!UPLOAD_TYPES.includes(file.type)) throw badRequest("Upload a PDF or an image (PNG, JPG, WebP)");
  if (file.size > MAX_DIRECT_UPLOAD) throw badRequest("That file is over 4 MB — upload it again and it'll go straight to storage");
  return saveUpload(file);
}

export async function listInvoices(user: SessionUser, businessId?: string | null) {
  if (businessId) await assertBusinessAccess(user, businessId);
  const access = await accessibleBusinessIds(user);
  return prisma.invoice.findMany({
    where: businessId ? { businessId } : accessWhere(access),
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { name: true } },
      business: { select: { name: true, slug: true, color: true } },
      payments: { select: { amount: true } },
    },
  });
}

export async function getInvoice(user: SessionUser, invoiceId: string) {
  await requireInvoiceAccess(user, invoiceId);
  return prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: { orderBy: { paidOn: "asc" } }, business: { select: { name: true, slug: true, color: true } } },
  });
}

export async function nextInvoiceNumber(user: SessionUser, businessId: string): Promise<string> {
  await assertBusinessAccess(user, businessId);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { invoicePrefix: true, invoiceNextNumber: true } });
  if (!business) throw notFound("That business");
  return previewInvoiceNumber(business);
}

export async function createInvoice(user: SessionUser, input: z.infer<typeof createInvoiceSchema>, form: FormData, req: Request) {
  await guardWrite(user);
  await assertBusinessAccess(user, input.businessId);

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, name: true, entity: true, archivedAt: true },
  });
  if (!business) throw notFound("That business");
  if (business.archivedAt) throw badRequest(`${business.name} is archived — restore it in Settings to raise invoices`);

  const isMulberry = business.entity === "MULBERRY";
  requireAddressForTaxInvoice(isMulberry, input.customerAddress);
  // An unregistered entity can't charge GST, whatever the form sent.
  const gstPercent = isMulberry ? 0 : input.gstPercent;

  // The source document is a convenience copy; the invoice must not be lost
  // because storage hiccupped. A rejected file (wrong type, too big) is still
  // the user's to fix, so that error goes back to them.
  let doFilePath = input.doFilePath ?? null;
  let warning: string | null = null;
  if (!doFilePath) {
    try {
      doFilePath = await storeUpload(form.get("doFile"));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      console.error("Couldn't store the invoice's source document; saving the invoice without it:", e);
      warning = "The invoice was saved, but the original document couldn't be attached. You can still print and email the invoice.";
    }
  }

  // A Bajaj-financed sale (raised from its DO) is disbursed in full, so it's
  // settled the moment it's raised. A GST-certificate sale is a direct B2B sale
  // paid like any other; a Mulberry booking records only the advance received.
  const bajajFinanced = !isMulberry && (input.source === "DO" || Boolean(input.doId));
  const initialPayment = bajajFinanced ? input.grossAmount : input.advancePaid > 0 ? Math.min(input.advancePaid, input.grossAmount) : 0;

  let invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      // Submitting the number the form suggested is the same as asking for the
      // next one: if someone else took it meanwhile, this still gets a free one.
      const series = await tx.business.findUniqueOrThrow({
        where: { id: business.id },
        select: { invoicePrefix: true, invoiceNextNumber: true },
      });
      const requested =
        input.invoiceNumber && input.invoiceNumber !== formatInvoiceNumber(series.invoicePrefix, series.invoiceNextNumber)
          ? input.invoiceNumber
          : null;
      const invoiceNumber = await allocateInvoiceNumber(tx, business.id, requested);

      return tx.invoice.create({
        data: {
          businessId: business.id,
          brand: business.entity,
          invoiceNumber,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate ?? input.invoiceDate,
          customerName: input.customerName,
          customerAddress: input.customerAddress,
          customerEmail: input.customerEmail,
          customerGstin: isMulberry ? null : input.customerGstin,
          placeOfSupply: input.placeOfSupply,
          itemDescription: input.itemDescription,
          hsnSac: input.hsnSac,
          qty: input.qty,
          grossAmount: input.grossAmount,
          gstPercent,
          notes: input.notes,
          terms: input.terms,
          doId: input.doId,
          doDate: input.doDate ?? null,
          doFilePath,
          createdById: user.id,
          ...(initialPayment > 0
            ? {
                payments: {
                  create: {
                    amount: initialPayment,
                    paidOn: input.invoiceDate,
                    method: bajajFinanced ? BAJAJ_DISBURSEMENT : "Advance",
                  },
                },
              }
            : {}),
        },
        include: { payments: true },
      });
    });
  } catch (e) {
    // The stored document would be orphaned (and billed) without its invoice.
    if (doFilePath && !input.doFilePath) await deleteUpload(doFilePath).catch(() => {});
    throw e;
  }

  await audit({
    user,
    businessId: business.id,
    action: "invoice.create",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `Raised ${invoice.invoiceNumber} for ${invoice.customerName} · ${rupees(invoice.grossAmount)}${
      initialPayment > 0 ? ` (${bajajFinanced ? "paid by Bajaj" : `advance ${rupees(initialPayment)}`})` : ""
    }`,
    req,
  });

  const [payment] = invoice.payments;
  if (payment) after(() => syncPayment(payment.id));
  return { invoice, warning };
}

const EDIT_LABELS = {
  invoiceNumber: "number",
  invoiceDate: "date",
  dueDate: "due date",
  customerName: "customer",
  customerAddress: "address",
  customerEmail: "email",
  customerGstin: "GSTIN",
  placeOfSupply: "place of supply",
  itemDescription: "item",
  hsnSac: "HSN/SAC",
  qty: "qty",
  grossAmount: "amount",
  gstPercent: "GST %",
  notes: "notes",
  terms: "terms",
  businessId: "business",
} as const;

export async function updateInvoice(user: SessionUser, invoiceId: string, input: z.infer<typeof updateInvoiceSchema>, req: Request) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);

  const existing = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: { select: { id: true, amount: true, method: true } } },
  });
  const isMulberry = existing.brand === "MULBERRY";
  requireAddressForTaxInvoice(isMulberry, input.customerAddress);

  // Moving between businesses keeps the legal entity: the printed seller can't change.
  let targetBusinessId = existing.businessId;
  if (input.businessId && input.businessId !== existing.businessId) {
    if (!isAdmin(user)) throw forbidden("Only an admin can move an invoice to another business");
    const target = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, entity: true, name: true } });
    if (!target) throw notFound("That business");
    if (target.entity !== existing.brand) {
      throw badRequest(`${target.name} bills as a different legal entity — an issued invoice can't change its seller`);
    }
    targetBusinessId = target.id;
  }

  if (input.invoiceNumber !== existing.invoiceNumber) {
    const clash = await prisma.invoice.findUnique({ where: { invoiceNumber: input.invoiceNumber }, select: { id: true } });
    if (clash) throw conflict(`Invoice ${input.invoiceNumber} already exists`);
  }

  // A Bajaj DO invoice was marked paid by its disbursement when raised. While
  // that's still its only payment, the disbursement follows the corrected amount.
  const [only] = existing.payments;
  const bajajPayment =
    existing.payments.length === 1 && only.method === BAJAJ_DISBURSEMENT && Math.abs(only.amount - existing.grossAmount) < 0.005
      ? only
      : null;
  const paid = round2(existing.payments.reduce((s, p) => s + p.amount, 0));
  if (!bajajPayment && input.grossAmount < paid - 0.005) {
    throw badRequest(`${rupees(paid)} has already been received against this invoice — the amount can't go below that`, {
      grossAmount: `At least ${rupees(paid)}`,
    });
  }

  const data = {
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate ?? input.invoiceDate,
    customerName: input.customerName,
    customerAddress: input.customerAddress,
    customerEmail: input.customerEmail,
    customerGstin: isMulberry ? existing.customerGstin : input.customerGstin,
    placeOfSupply: input.placeOfSupply,
    itemDescription: input.itemDescription,
    hsnSac: input.hsnSac,
    qty: input.qty,
    grossAmount: input.grossAmount,
    // Mulberry isn't GST-registered; its stored rate is left as it was.
    gstPercent: isMulberry ? existing.gstPercent : input.gstPercent,
    notes: input.notes,
    terms: input.terms,
    businessId: targetBusinessId,
  };
  const changed = diff(existing, data, EDIT_LABELS);
  if (Object.keys(changed.changes).length === 0) return existing;

  const invoice = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ...data,
        // The customer already holds the emailed copy, so this one is a revision.
        ...(existing.emailSentAt ? { revisedAt: new Date() } : {}),
      },
    });
    if (bajajPayment && (bajajPayment.amount !== input.grossAmount || data.invoiceDate.getTime() !== existing.invoiceDate.getTime())) {
      await tx.payment.update({ where: { id: bajajPayment.id }, data: { amount: input.grossAmount, paidOn: data.invoiceDate } });
    }
    // A number typed ahead of the series moves the counter past it.
    const series = await tx.business.findUniqueOrThrow({ where: { id: targetBusinessId }, select: { invoicePrefix: true, invoiceNextNumber: true } });
    const seq = seqInSeries(input.invoiceNumber, series.invoicePrefix);
    if (seq !== null && seq >= series.invoiceNextNumber) {
      await tx.business.update({ where: { id: targetBusinessId }, data: { invoiceNextNumber: seq + 1 } });
    }
    return updated;
  });

  await audit({
    user,
    businessId: targetBusinessId,
    action: targetBusinessId !== existing.businessId ? "invoice.move" : "invoice.update",
    entityType: "invoice",
    entityId: invoiceId,
    summary: `Edited ${invoice.invoiceNumber}: ${changed.summary}`,
    changes: changed.changes,
    req,
  });

  // Customer, number and amounts appear on every payment's sheet row; a move
  // also takes the rows out of the old business's sheet.
  if (existing.payments.length > 0) {
    after(async () => {
      if (targetBusinessId !== existing.businessId) {
        for (const p of existing.payments) await unsyncPayment(existing.businessId, p.id);
      }
      await syncInvoicePayments(invoiceId);
    });
  }
  return invoice;
}

export async function deleteInvoice(user: SessionUser, invoiceId: string, req: Request) {
  await guardWrite(user);
  if (!isAdmin(user)) throw forbidden("Only an admin can delete an invoice");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      businessId: true,
      invoiceNumber: true,
      customerName: true,
      grossAmount: true,
      doFilePath: true,
      payments: { select: { id: true, proofPath: true } },
    },
  });
  if (!invoice) throw notFound("That invoice");

  await prisma.invoice.delete({ where: { id: invoiceId } });
  await audit({
    user,
    businessId: invoice.businessId,
    action: "invoice.delete",
    entityType: "invoice",
    entityId: invoiceId,
    summary: `Deleted ${invoice.invoiceNumber} (${invoice.customerName}, ${rupees(invoice.grossAmount)}) and its ${invoice.payments.length} payment(s)`,
    req,
  });

  // Payments went with it (cascade): their sheet rows and stored files must go too.
  after(async () => {
    for (const p of invoice.payments) await unsyncPayment(invoice.businessId, p.id);
    const files = [invoice.doFilePath, ...invoice.payments.map((p) => p.proofPath)].filter((f): f is string => Boolean(f));
    for (const f of files) await deleteUpload(f).catch(() => {});
  });
}
