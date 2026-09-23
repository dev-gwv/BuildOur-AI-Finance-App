import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { UnsupportedUpload, deleteUpload, saveUpload } from "@/lib/storage";
import { syncInvoicePayments, syncPayment, unsyncPayment } from "@/lib/sheet";
import { accessibleBusinessIds, accessWhere, assertBusinessAccess, requireInvoiceAccess } from "../access";
import { audit, diff } from "../audit";
import { allocateInvoiceNumber, businessSummarySelect, nextInvoiceNumberPreview } from "../businesses";
import { assertPeriodOpen } from "../gstLock";
import { invoiceSummaryFields, type LineInput } from "@/lib/invoiceLines";
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

/** Method on the payment that records Bajaj Finance paying out a financed sale. */
export const BAJAJ_DISBURSEMENT = "Bajaj Finance disbursement";
/** Method on the down payment a Bajaj customer pays the dealer directly. */
export const DOWN_PAYMENT = "Down payment";

/** Checkbox values from a form ("on"), JSON (true) or a string flag ("true"). */
const flag = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).default(false);

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

/** One line: GST-inclusive amount at its own rate. */
const lineSchema = z.object({
  description: requiredText("Item", 500),
  hsnSac: z.string().trim().max(20).default(""),
  qty: z.coerce.number({ error: "Quantity must be a number" }).positive("More than 0").max(100_000).default(1),
  grossAmount: positiveMoney("Amount"),
  gstPercent: z.coerce.number({ error: "GST % must be a number" }).min(0, "Can't be negative").max(28, "At most 28%").default(18),
});

/**
 * `lines` arrives as a JSON string in the create form (a multipart upload),
 * or as an array in the edit JSON. Either way: 1–50 lines.
 */
const linesField = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return "invalid";
    }
  }, z.array(lineSchema, { error: "The items couldn't be read — reload and try again" }).min(1, "Add at least one item").max(50, "At most 50 items"))
  .optional();

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
  // Line items (the source of truth). Older clients send one item in the
  // flat fields below instead; they're turned into a single line.
  lines: linesField,
  itemDescription: z.string().trim().max(500).optional(),
  hsnSac: z.string().trim().max(20).default(""),
  qty: z.coerce.number({ error: "Quantity must be a number" }).positive("Quantity must be more than zero").max(100_000).default(1),
  grossAmount: money("Amount").optional(),
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
  /** BAJAJ = financed by Bajaj Finance (raised from its DO); DIRECT = the customer pays us. */
  saleType: z.enum(["BAJAJ", "DIRECT"]).optional(),
  /** Bajaj sales: what the customer pays the dealer up front. */
  downPayment: money("Down payment").default(0),
  /** Bajaj sales: the down payment has already been received. */
  downPaymentReceived: flag,
  advancePaid: money("Advance").default(0),
});

export const updateInvoiceSchema = z.object({
  invoiceNumber: requiredText("Invoice number", 40),
  ...invoiceFields,
  /** Move to another business of the same legal entity (admins only). */
  businessId: id.optional(),
  /** Bajaj sales only: the DO number and the down payment (financed amount follows). */
  doId: blankAsMissing(optionalText(40)),
  downPayment: blankAsMissing(money("Down payment").optional()),
});

/**
 * The invoice's lines, from `lines` or the legacy single-item fields, checked
 * for what a tax invoice needs. Unregistered sellers (Mulberry) charge no GST
 * and need no HSN.
 */
function resolveLines(
  input: { lines?: LineInput[]; itemDescription?: string; hsnSac: string; qty: number; grossAmount?: number; gstPercent: number },
  gstRegistered: boolean
): LineInput[] {
  let lines: LineInput[];
  if (input.lines?.length) {
    lines = input.lines;
  } else {
    const fields: Record<string, string> = {};
    if (!input.itemDescription) fields["lines.0.description"] = "Describe the item";
    if (!(input.grossAmount && input.grossAmount > 0)) fields["lines.0.grossAmount"] = "Enter the amount";
    if (Object.keys(fields).length) throw badRequest("Add at least one item with an amount", fields);
    lines = [{ description: input.itemDescription!, hsnSac: input.hsnSac, qty: input.qty, grossAmount: input.grossAmount!, gstPercent: input.gstPercent }];
  }
  const fields: Record<string, string> = {};
  lines = lines.map((l, i) => {
    if (gstRegistered && !l.hsnSac) fields[`lines.${i}.hsnSac`] = "HSN/SAC is required on a tax invoice";
    return { ...l, gstPercent: gstRegistered ? l.gstPercent : 0, hsnSac: l.hsnSac ?? "" };
  });
  if (Object.keys(fields).length) throw badRequest("Every item needs its HSN/SAC code", fields);
  return lines;
}

const linesCreate = (lines: LineInput[]) => lines.map((l, position) => ({ position, ...l }));

/** Bajaj sales: the down payment must leave something for Bajaj to finance. */
function checkDownPayment(downPayment: number, price: number) {
  if (downPayment < 0) throw badRequest("The down payment can't be negative", { downPayment: "Can't be negative" });
  if (downPayment >= price) {
    throw badRequest("The down payment must be less than the product price — Bajaj finances the rest", {
      downPayment: `Less than ${rupees(price)}`,
    });
  }
}

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
  try {
    return await saveUpload(file);
  } catch (e) {
    // The file's bytes aren't what it claims to be: the user's to fix, not a storage outage.
    if (e instanceof UnsupportedUpload) throw badRequest(e.message);
    throw e;
  }
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
    include: {
      payments: { orderBy: { paidOn: "asc" } },
      lines: { orderBy: { position: "asc" } },
      business: { select: { name: true, slug: true, color: true } },
    },
  });
}

export async function nextInvoiceNumber(user: SessionUser, businessId: string): Promise<string> {
  await assertBusinessAccess(user, businessId);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: businessSummarySelect });
  if (!business) throw notFound("That business");
  return nextInvoiceNumberPreview(business);
}

export async function createInvoice(user: SessionUser, input: z.infer<typeof createInvoiceSchema>, form: FormData, req: Request) {
  await guardWrite(user);
  await assertBusinessAccess(user, input.businessId);

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { ...businessSummarySelect, archivedAt: true },
  });
  if (!business) throw notFound("That business");
  if (business.archivedAt) throw badRequest(`${business.name} is archived — restore it in Settings to raise invoices`);

  const isMulberry = business.entity === "MULBERRY";
  requireAddressForTaxInvoice(isMulberry, input.customerAddress);
  await assertPeriodOpen(business.id, [input.invoiceDate], "This invoice's date");
  // An unregistered entity can't charge GST, whatever the form sent.
  const lines = resolveLines(input, !isMulberry);
  const summary = invoiceSummaryFields(lines);
  const total = summary.grossAmount;

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

  // A Bajaj sale is financed: the customer may pay a down payment, and Bajaj
  // pays the financed amount later, less its dealer charges — recorded when it
  // actually reaches the bank (see recordBajajDisbursement). Nothing is marked
  // paid on its behalf here. A direct sale is paid like any other; a Mulberry
  // booking records only the advance received.
  const saleType = isMulberry ? "DIRECT" : (input.saleType ?? (input.source === "DO" || input.doId ? "BAJAJ" : "DIRECT"));
  const isBajaj = saleType === "BAJAJ";
  if (isBajaj && !input.doId) {
    throw badRequest("Enter the DO number from Bajaj's delivery order", { doId: "The DO number is required for a Bajaj sale" });
  }
  const downPayment = isBajaj ? round2(input.downPayment) : null;
  if (isBajaj) checkDownPayment(downPayment!, total);
  const financedAmount = isBajaj ? round2(total - downPayment!) : null;

  const initialPayment = isBajaj
    ? input.downPaymentReceived && downPayment! > 0
      ? downPayment!
      : 0
    : isMulberry && input.advancePaid > 0
      ? Math.min(input.advancePaid, total)
      : 0;
  const initialMethod = isBajaj ? DOWN_PAYMENT : "Advance";

  const suggested = input.invoiceNumber ? await nextInvoiceNumberPreview(business, input.invoiceDate) : null;

  let invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      // Submitting the number the form suggested is the same as asking for the
      // next one: if someone else took it meanwhile, this still gets a free one.
      const requested = input.invoiceNumber && input.invoiceNumber !== suggested ? input.invoiceNumber : null;
      // The invoice date picks the financial year when the series restarts each April.
      const invoiceNumber = await allocateInvoiceNumber(tx, business.id, requested, input.invoiceDate);

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
          ...summary,
          lines: { create: linesCreate(lines) },
          notes: input.notes,
          terms: input.terms,
          doId: input.doId,
          doDate: input.doDate ?? null,
          doFilePath,
          saleType,
          downPayment,
          financedAmount,
          createdById: user.id,
          ...(initialPayment > 0
            ? {
                payments: {
                  create: {
                    amount: initialPayment,
                    paidOn: input.invoiceDate,
                    method: initialMethod,
                  },
                },
              }
            : {}),
        },
        include: { payments: true, lines: { orderBy: { position: "asc" } } },
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
      lines.length > 1 ? ` · ${lines.length} items` : ""
    }${
      isBajaj ? ` · Bajaj DO ${invoice.doId}, financing ${rupees(financedAmount!)}` : ""
    }${initialPayment > 0 ? ` (${initialMethod.toLowerCase()} ${rupees(initialPayment)} received)` : ""}`,
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
  doId: "DO number",
  downPayment: "down payment",
  financedAmount: "financed amount",
} as const;

export async function updateInvoice(user: SessionUser, invoiceId: string, input: z.infer<typeof updateInvoiceSchema>, req: Request) {
  await guardWrite(user);
  await requireInvoiceAccess(user, invoiceId);

  const existing = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      payments: { select: { id: true, amount: true, method: true } },
      lines: { orderBy: { position: "asc" } },
    },
  });
  if (existing.status === "CANCELLED") throw conflict(`${existing.invoiceNumber} is cancelled — it can't be edited`);
  const isMulberry = existing.brand === "MULBERRY";
  requireAddressForTaxInvoice(isMulberry, input.customerAddress);
  // Neither the old date nor the new one may be in a period whose GST is filed.
  await assertPeriodOpen(existing.businessId, [existing.invoiceDate, input.invoiceDate], existing.invoiceNumber);
  const lines = resolveLines(input, !isMulberry);
  const summary = invoiceSummaryFields(lines);
  const total = summary.grossAmount;

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

  // A Bajaj DO invoice was marked paid by its disbursement when raised. While
  // that's still its only payment, the disbursement follows the corrected amount.
  const [only] = existing.payments;
  const bajajPayment =
    existing.payments.length === 1 && only.method === BAJAJ_DISBURSEMENT && Math.abs(only.amount - existing.grossAmount) < 0.005
      ? only
      : null;
  const paid = round2(existing.payments.reduce((s, p) => s + p.amount, 0));

  // Bajaj sales: the DO number stays required, and the financed amount follows
  // the price and down payment — until Bajaj has actually paid out against it.
  const isBajaj = existing.saleType === "BAJAJ";
  let bajajFields: { doId: string | null; downPayment: number | null; financedAmount: number | null } | null = null;
  if (isBajaj) {
    const doId = input.doId ?? existing.doId;
    if (!doId) throw badRequest("A Bajaj sale needs its DO number", { doId: "The DO number is required for a Bajaj sale" });
    const downPayment = round2(input.downPayment ?? existing.downPayment ?? 0);
    checkDownPayment(downPayment, total);
    const financedAmount = round2(total - downPayment);
    const disbursed = existing.payments.some((p) => p.method === BAJAJ_DISBURSEMENT);
    if (disbursed && !bajajPayment && Math.abs(financedAmount - (existing.financedAmount ?? financedAmount)) > 0.005) {
      throw badRequest("Bajaj has already paid out on this sale — the price and down payment can't change the financed amount now", {
        downPayment: "Locked after the disbursement",
      });
    }
    bajajFields = { doId, downPayment, financedAmount };
  }
  if (!bajajPayment && total < paid - 0.005) {
    throw badRequest(`${rupees(paid)} has already been received against this invoice — the total can't go below that`, {
      [`lines.${lines.length - 1}.grossAmount`]: `The total must stay at least ${rupees(paid)}`,
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
    ...summary,
    notes: input.notes,
    terms: input.terms,
    businessId: targetBusinessId,
    ...(bajajFields ?? {}),
  };
  const changed = diff(existing, data, EDIT_LABELS);
  // Lines are compared as a whole: any edit to an item's text, qty, amount or rate.
  const lineKey = (ls: LineInput[]) => JSON.stringify(ls.map((l) => [l.description, l.hsnSac, l.qty, l.grossAmount, l.gstPercent]));
  const linesChanged = lineKey(existing.lines) !== lineKey(lines);
  if (linesChanged) {
    changed.changes.lines = { from: existing.lines.length, to: lines.length };
    const note = existing.lines.length === lines.length ? "items edited" : `items ${existing.lines.length} → ${lines.length}`;
    changed.summary = changed.summary ? `${changed.summary}, ${note}` : note;
  }
  if (Object.keys(changed.changes).length === 0) return existing;

  const invoice = await prisma.$transaction(async (tx) => {
    // A changed number is checked and moves the series counter past it
    // (the same rules as typing a number on a new invoice).
    if (input.invoiceNumber !== existing.invoiceNumber) {
      await allocateInvoiceNumber(tx, targetBusinessId, input.invoiceNumber, input.invoiceDate);
    }
    if (linesChanged) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId } });
      await tx.invoiceLine.createMany({ data: linesCreate(lines).map((l) => ({ ...l, invoiceId })) });
    }
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ...data,
        // The customer already holds the emailed copy, so this one is a revision.
        ...(existing.emailSentAt ? { revisedAt: new Date() } : {}),
      },
    });
    if (bajajPayment && (bajajPayment.amount !== total || data.invoiceDate.getTime() !== existing.invoiceDate.getTime())) {
      await tx.payment.update({ where: { id: bajajPayment.id }, data: { amount: total, paidOn: data.invoiceDate } });
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
      invoiceDate: true,
      customerName: true,
      grossAmount: true,
      doFilePath: true,
      emailSentAt: true,
      payments: { select: { id: true, proofPath: true } },
      _count: { select: { creditNotes: true } },
    },
  });
  if (!invoice) throw notFound("That invoice");
  // An issued invoice is a tax document: once money has moved against it, a
  // credit note exists, or the customer has a copy, it's cancelled (keeping
  // its number, so the series has no gap) — never deleted.
  if (invoice.payments.length > 0 || invoice._count.creditNotes > 0 || invoice.emailSentAt) {
    const why =
      invoice.payments.length > 0
        ? "it has payments recorded"
        : invoice._count.creditNotes > 0
          ? "it has credit notes"
          : "it has already been emailed to the customer";
    throw conflict(`${invoice.invoiceNumber} can't be deleted because ${why}. Cancel it instead.`);
  }
  await assertPeriodOpen(invoice.businessId, [invoice.invoiceDate], invoice.invoiceNumber);

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
