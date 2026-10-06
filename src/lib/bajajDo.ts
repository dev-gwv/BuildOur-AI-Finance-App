import { z } from "zod";

/**
 * A Bajaj DO's amount table, kept on the invoice. On the DO:
 *
 *   A Product Price          1,18,000   what the invoice is for
 *   C Net Loan Amount          98,334   what Bajaj finances
 *   Y DP from Customer         21,283   what the customer hands the dealer:
 *                                        A − C toward the price (the advance
 *                                        EMIs) + Bajaj's own charges
 *   H Dealer Interest Subsidy  11,501   the dealer's real cost of the sale
 *   U Total GST                 1,755   GST inside what Bajaj charges the dealer
 *   AA Net Disbursement        85,216   what Bajaj pays into the bank
 *
 * So Bajaj pays out the net loan less the subsidy and less its charges (which
 * the customer already paid the dealer): 98,334 − 11,501 − 1,617 = 85,216.
 */
export type DoDetails = {
  productPrice: number | null;
  grossLoanAmount: number | null;
  netLoanAmount: number | null;
  netDisbursement: number | null;
  totalDeductions: number | null;
  /** Row Y: what the customer pays the dealer at delivery, Bajaj's charges included. */
  downPayment: number | null;
  advanceEmi: number | null;
  advanceEmis: number | null;
  dealerSubsidy: number | null;
  dealerSubsidyPercent: number | null;
  /** Upfront interest, service, card, mandate and convenience charges. */
  bajajCharges: number | null;
  totalGst: number | null;
  emi: number | null;
  tenureMonths: number | null;
};

const KEYS = [
  "productPrice",
  "grossLoanAmount",
  "netLoanAmount",
  "netDisbursement",
  "totalDeductions",
  "downPayment",
  "advanceEmi",
  "advanceEmis",
  "dealerSubsidy",
  "dealerSubsidyPercent",
  "bajajCharges",
  "totalGst",
  "emi",
  "tenureMonths",
] as const satisfies readonly (keyof DoDetails)[];

const figure = z.number().finite().min(0).max(100_000_000).nullable().catch(null);

/** The figures a DO parse returned (or a stored invoice holds), nothing else. */
export const doDetailsSchema = z
  .object(Object.fromEntries(KEYS.map((k) => [k, figure.optional()])) as Record<(typeof KEYS)[number], z.ZodOptional<typeof figure>>)
  .transform((d) => Object.fromEntries(KEYS.map((k) => [k, d[k] ?? null])) as DoDetails);

export function pickDoDetails(source: Partial<Record<keyof DoDetails, unknown>>): DoDetails | null {
  const parsed = doDetailsSchema.safeParse(source);
  if (!parsed.success) return null;
  // Nothing beyond the price: an older DO layout, nothing worth keeping.
  const { productPrice: _price, ...rest } = parsed.data;
  return Object.values(rest).some((v) => v !== null) ? parsed.data : null;
}

/** A stored invoice's DO figures, or null for a sale raised before they were kept. */
export function readDoDetails(json: unknown): DoDetails | null {
  if (!json || typeof json !== "object") return null;
  return pickDoDetails(json as Record<string, unknown>);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The part of what the customer pays at delivery that isn't toward the
 * invoice: Bajaj's own charges, collected by the dealer and taken back out of
 * the payout. Zero when the DO doesn't say.
 */
export function chargesCollected(details: DoDetails | null, downPaymentTowardInvoice: number): number {
  if (!details?.downPayment) return 0;
  return Math.max(0, round2(details.downPayment - downPaymentTowardInvoice));
}

/** What the DO says Bajaj will keep out of the net loan: the subsidy plus its charges. */
export function expectedBajajDeduction(details: DoDetails | null): number | null {
  if (details?.netLoanAmount == null || details.netDisbursement == null) return null;
  return round2(details.netLoanAmount - details.netDisbursement);
}
