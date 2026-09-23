import { NextRequest, NextResponse } from "next/server";
import { badRequest, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { enforce } from "@/server/rateLimit";
import { parseUploadedDocument, parseUploadedText } from "@/lib/parseDeliveryOrder";

/** Reading a PDF is CPU-heavy, so it's capped per user; the file is only read, never stored. */
const MAX_PDF = 10 * 1024 * 1024;

export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  await enforce("parsePerUser", user.id);

  // Throws on a non-multipart body, which is a bad request rather than a fault.
  const form = await req.formData().catch(() => null);

  // A photo or screenshot is OCR'd in the browser and arrives as its text.
  const ocrText = form?.get("text");
  if (typeof ocrText === "string") {
    const text = ocrText.replace(/\s+/g, " ").trim().slice(0, 50_000);
    if (text.length < 20) throw badRequest("Couldn't make out any text in that image — try a sharper photo");
    return NextResponse.json({ parsed: parseUploadedText(text), ocr: true });
  }

  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw badRequest("No file uploaded");
  if (file.size > MAX_PDF) throw badRequest("That PDF is over 10 MB — is it the right file?");

  let parsed;
  try {
    parsed = await parseUploadedDocument(Buffer.from(await file.arrayBuffer()));
  } catch {
    // Anything unreadable (wrong file, corrupt or scanned PDF) is the input
    // being wrong, not a server fault — say so plainly.
    throw badRequest("Couldn't read that file as a PDF. Please upload the Bajaj delivery order or the customer's GST certificate.");
  }

  // A scanned PDF is just pictures of pages: there's no text to read.
  const empty =
    parsed.docType === "DO" ? !parsed.doId && !parsed.customerName && !parsed.productPrice : !parsed.gstin && !parsed.legalName;
  if (empty) {
    throw badRequest(
      "Couldn't find DO or GST certificate details in that PDF. If it's a scan, upload a photo or screenshot of it instead — it'll be read with OCR."
    );
  }

  return NextResponse.json({ parsed });
});
