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
