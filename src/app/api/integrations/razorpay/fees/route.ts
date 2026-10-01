import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/server/errors";
import { requireAdmin } from "@/server/session";
import { enforce } from "@/server/rateLimit";
import { refreshRazorpayFees } from "@/server/services/razorpayFees";

/** Re-reads Razorpay's commission onto payments recorded in the last 180 days. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const admin = await requireAdmin();
  await enforce("razorpayPerUser", admin.id);
  return NextResponse.json(await refreshRazorpayFees(admin, req));
});
