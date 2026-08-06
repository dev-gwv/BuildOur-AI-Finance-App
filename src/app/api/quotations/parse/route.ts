import { NextRequest, NextResponse } from "next/server";
import { extractText } from "unpdf";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { parseQuotationText } from "@/lib/parseQuotation";

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireUser();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, "No file uploaded");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    parsed = parseQuotationText(text.replace(/\s+/g, " "), file.name);
  } catch {
    throw new ApiError(400, "Couldn't read that file as a PDF. Please upload the quotation PDF.");
  }

  return NextResponse.json({ parsed });
});
