import { prisma } from "./prisma";
import {
  gstCreditLine,
  gstLine,
  gstPeriodRange,
  hsnSummary,
  inputGst,
  monthlySummary,
  netGstPayable,
  netOfCredits,
  sumLines,
  type GstPeriodKey,
} from "./gstReport";
import type { Scope } from "@/server/scope";
import type { BusinessSummary } from "@/server/businesses";
import { chargesGst, sellerStateCode, type BrandKey } from "./brands";

/**
 * The businesses a GST report can cover in the current scope: only those that
 * bill under a GST-registered entity (Grateful, Vertex). Mulberry isn't
 * registered, so it never appears.
 */
export function gstBusinesses(scope: Scope): BusinessSummary[] {
  const pool = scope.current ? [scope.current] : scope.businesses;
  return pool.filter((b) => chargesGst(b.entity));
}

/**
 * Which GSTIN to report on — one entity at a time, since each files its own
 * returns: the requested business's entity, else the requested entity, else
 * the current business's, else Grateful (or whichever one is available).
 */
export function resolveGstEntity(scope: Scope, requested?: string | null, requestedEntity?: string | null): BrandKey | null {
  const candidates = gstBusinesses(scope);
  const byId = requested ? candidates.find((b) => b.id === requested) : undefined;
  if (byId) return byId.entity as BrandKey;
  if (requestedEntity && candidates.some((b) => b.entity === requestedEntity)) return requestedEntity as BrandKey;
  const grateful = candidates.find((b) => b.entity === "GRATEFUL");
  return ((grateful ?? candidates[0])?.entity as BrandKey | undefined) ?? null;
}

/**
 * The business ids to report on: the entity's businesses, or the one
 * requested (a ?businessId= filter) if it's among them. Anything else is
 * ignored, so a crafted id can't reach a business the user can't see.
 */
export function resolveGstBusinessIds(scope: Scope, entity: BrandKey | null, requested?: string | null): string[] {
  const allowed = gstBusinesses(scope)
    .filter((b) => b.entity === entity)
    .map((b) => b.id);
  if (requested && allowed.includes(requested)) return [requested];
  return allowed;
}

/**
 * Everything the GST report and its export show, for one period across the
 * given businesses (already access-checked — use resolveGstBusinessIds).
 * Output GST comes from invoices issued under Grateful; input GST from money-
 * out entries of those businesses and from gateway fees on their invoices.
 */
export async function loadGstReport({ businessIds, period, entity }: { businessIds: string[]; period: GstPeriodKey; entity: BrandKey }) {
  const homeCode = sellerStateCode(entity);
  const range = gstPeriodRange(period, new Date());
  const within = { gte: range.start, lt: range.end };
  const inBusinesses = { businessId: { in: businessIds } };

  const [invoices, cancelled, creditNotes, costs, fees, locks] = await Promise.all([
    prisma.invoice.findMany({
      // brand is the entity snapshot at issue — the GSTIN the tax was charged under.
      where: { ...inBusinesses, brand: entity, status: { not: "CANCELLED" }, invoiceDate: within },
      orderBy: { invoiceDate: "asc" },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        customerName: true,
        customerGstin: true,
        placeOfSupply: true,
        grossAmount: true,
        gstPercent: true,
        qty: true,
        business: { select: { name: true } },
        lines: { orderBy: { position: "asc" }, select: { description: true, hsnSac: true, qty: true, grossAmount: true, gstPercent: true } },
      },
    }),
    // Cancelled invoices keep their numbers but aren't reported; listed so the gap is explained.
    prisma.invoice.findMany({
      where: { ...inBusinesses, brand: entity, status: "CANCELLED", invoiceDate: within },
      orderBy: { invoiceDate: "asc" },
      select: { id: true, invoiceNumber: true, invoiceDate: true, customerName: true, grossAmount: true, cancelReason: true, business: { select: { name: true } } },
    }),
    prisma.creditNote.findMany({
      where: { ...inBusinesses, noteDate: within, invoice: { brand: entity } },
      orderBy: { noteDate: "asc" },
      select: {
        id: true,
        number: true,
        noteDate: true,
        reason: true,
        grossAmount: true,
        gstPercent: true,
        business: { select: { name: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            invoiceDate: true,
            customerName: true,
            customerGstin: true,
            placeOfSupply: true,
            hsnSac: true,
            lines: { orderBy: { grossAmount: "desc" }, take: 1, select: { hsnSac: true } },
          },
        },
      },
    }),
    prisma.expense.findMany({
      where: { ...inBusinesses, direction: "OUT", date: within, gstAmount: { gt: 0 } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        description: true,
        grossAmount: true,
        gstPercent: true,
        gstAmount: true,
        business: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { paidOn: within, feeGstAmount: { gt: 0 }, invoice: { ...inBusinesses, brand: entity } },
      orderBy: { paidOn: "asc" },
      select: {
        id: true,
        paidOn: true,
        gateway: true,
        feeAmount: true,
        feeGstAmount: true,
        invoice: { select: { invoiceNumber: true, customerName: true } },
      },
    }),
    prisma.business.findMany({ where: { id: { in: businessIds } }, select: { name: true, gstLockedThrough: true } }),
  ]);

  const lines = invoices.map(({ business, lines: items, ...inv }) => gstLine({ ...inv, business: business.name, lines: items }, homeCode));
  const credits = creditNotes.map((cn) =>
    gstCreditLine({
      id: cn.id,
      number: cn.number,
      noteDate: cn.noteDate,
      reason: cn.reason,
      grossAmount: cn.grossAmount,
      gstPercent: cn.gstPercent,
      invoiceNumber: cn.invoice.invoiceNumber,
      invoiceDate: cn.invoice.invoiceDate,
      customerName: cn.invoice.customerName,
      customerGstin: cn.invoice.customerGstin,
      placeOfSupply: cn.invoice.placeOfSupply,
      business: cn.business.name,
      hsnSac: cn.invoice.lines[0]?.hsnSac ?? cn.invoice.hsnSac,
    }, homeCode)
  );
  const output = sumLines(lines);
  const creditTotals = sumLines(credits);
  const netOutput = netOfCredits(output, creditTotals);
  const input = inputGst(
    costs.map((c) => c.gstAmount),
    fees.map((f) => f.feeGstAmount)
  );

  return {
    range,
    lines,
    months: monthlySummary(lines, credits),
    output,
    b2b: sumLines(lines.filter((l) => l.b2b)),
    b2c: sumLines(lines.filter((l) => !l.b2b)),
    /** Credit notes to registered customers (CDNR) and to consumers (CDNUR). */
    credits,
    cdnr: sumLines(credits.filter((c) => c.b2b)),
    cdnur: sumLines(credits.filter((c) => !c.b2b)),
    creditTotals,
    netOutput,
    hsn: hsnSummary(lines, credits),
    cancelled: cancelled.map(({ business, ...c }) => ({ ...c, business: business.name })),
    /** Per business, the date its GST is filed (locked) through, if any. */
    locks: locks.map((l) => ({ business: l.name, through: l.gstLockedThrough })),
    costs,
    fees,
    input,
    // Payable on output net of credit notes, less input credit.
    netPayable: netGstPayable(netOutput, input),
  };
}

export type GstReport = Awaited<ReturnType<typeof loadGstReport>>;
