import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrors } from "@/lib/api-auth";
import { parseDeliveryOrder } from "@/lib/parseDeliveryOrder";

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireUser();
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseDeliveryOrder(buffer);

  return NextResponse.json({ parsed });
});
