import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { parseUploadedDocument, parseUploadedText } from "@/lib/parseDeliveryOrder";

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireUser();

  // Throws on a non-multipart body, which is a bad request rather than a fault.
  const form = await req.formData().catch(() => null);

  // A photo or screenshot is OCR'd in the browser and arrives as its text.
  const ocrText = form?.get("text");
  if (typeof ocrText === "string") {
    const text = ocrText.replace(/\s+/g, " ").trim();
    if (text.length < 20) throw new ApiError(400, "Couldn't make out any text in that image — try a sharper photo");
    return NextResponse.json({ parsed: parseUploadedText(text), ocr: true });
  }

  const file = form?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, "No file uploaded");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseUploadedDocument(buffer);
  } catch {
    // Anything unreadable (wrong file picked, corrupt or scanned PDF) is the
    // user's input being wrong, not a server fault — say so plainly.
    throw new ApiError(
      400,
      "Couldn't read that file as a PDF. Please upload the Bajaj delivery order or the customer's GST certificate."
    );
  }

  // A scanned PDF is just pictures of pages: there's no text to read.
  const empty =
    parsed.docType === "DO"
      ? !parsed.doId && !parsed.customerName && !parsed.productPrice
      : !parsed.gstin && !parsed.legalName;
  if (empty) {
    throw new ApiError(
      400,
      "Couldn't find DO or GST certificate details in that PDF. If it's a scan, upload a photo or screenshot of it instead — it'll be read with OCR."
    );
  }

  return NextResponse.json({ parsed });
});
