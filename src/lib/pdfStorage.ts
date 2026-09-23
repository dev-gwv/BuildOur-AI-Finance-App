import { put } from "@vercel/blob";

/** Same folder as other uploads, so /api/uploads/[name] can serve it after its access check. */
const PREFIX = "screenshots/";

/**
 * Stores a PDF the app generated itself (e.g. the exact invoice emailed to a
 * customer) and returns the opaque stored name. Our own output, so there's no
 * need for the byte check user uploads go through — but it's still a real PDF.
 */
export async function saveGeneratedPdf(pdf: Buffer): Promise<string> {
  const name = `${crypto.randomUUID()}.pdf`;
  await put(`${PREFIX}${name}`, pdf, { access: "private", addRandomSuffix: false, contentType: "application/pdf" });
  return name;
}
