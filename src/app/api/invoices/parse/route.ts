import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { parseDeliveryOrder } from "@/lib/parseDeliveryOrder";

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireUser();

  // Throws on a non-multipart body, which is a bad request rather than a fault.
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, "No file uploaded");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseDeliveryOrder(buffer);
  } catch {
    // Anything unreadable (wrong file picked, corrupt or scanned PDF) is the
    // user's input being wrong, not a server fault — say so plainly.
    throw new ApiError(400, "Couldn't read that file as a PDF. Please upload the Bajaj delivery order PDF.");
  }

  return NextResponse.json({ parsed });
});
