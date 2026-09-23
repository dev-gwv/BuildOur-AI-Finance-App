export interface BreakupInput {
  grossAmount: number;
  gatewayChargePercent: number;
  gstPercent: number;
}

export interface BreakupResult {
  gatewayChargeAmount: number;
  afterGatewayAmount: number;
  gstAmount: number;
  netAmount: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Sequential breakup: gross -> minus gateway charge -> minus GST -> net revenue.
export function calculateBreakup({
  grossAmount,
  gatewayChargePercent,
  gstPercent,
}: BreakupInput): BreakupResult {
  const gatewayChargeAmount = round2(grossAmount * (gatewayChargePercent / 100));
  const afterGatewayAmount = round2(grossAmount - gatewayChargeAmount);
  const gstAmount = round2(afterGatewayAmount * (gstPercent / 100));
  const netAmount = round2(afterGatewayAmount - gstAmount);

  return { gatewayChargeAmount, afterGatewayAmount, gstAmount, netAmount };
}

export interface CostBreakup {
  gstAmount: number;
  netAmount: number;
}

/**
 * A cost (money out) is billed GST-inclusive, so the GST is backed out of the
 * total rather than taken off it: ₹1,180 at 18% is ₹1,000 + ₹180 GST.
 */
export function calculateCostBreakup({ grossAmount, gstPercent }: { grossAmount: number; gstPercent: number }): CostBreakup {
  const netAmount = round2(grossAmount / (1 + gstPercent / 100));
  return { gstAmount: round2(grossAmount - netAmount), netAmount };
}

export interface GatewayFee {
  feeAmount: number;
  feeGstAmount: number;
  /** What actually lands in the bank. */
  netAmount: number;
}

/**
 * A gateway's cut of a payment: its commission, plus 18% GST it charges on that
 * commission (not on the payment). ₹10,000 at 2% = ₹200 fee + ₹36 GST, ₹9,764 settled.
 */
export function calculateGatewayFee(amount: number, feePercent: number, feeGstPercent: number): GatewayFee {
  const feeAmount = round2(amount * (feePercent / 100));
  const feeGstAmount = round2(feeAmount * (feeGstPercent / 100));
  return { feeAmount, feeGstAmount, netAmount: round2(amount - feeAmount - feeGstAmount) };
}
