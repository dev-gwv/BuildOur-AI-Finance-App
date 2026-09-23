import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SERVE_TYPES, readUpload } from "@/lib/storage";
import { ApiError, badRequest, notFound, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { assertBusinessAccess } from "@/server/access";

type Params = { params: Promise<{ filename: string }> };

/**
 * Streams a private stored file (proof screenshot, DO, quotation) after
 * checking the user can access the business of the record that owns it.
 * A file no record owns is never served.
 */
export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { filename } = await params;
  if (!/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]{1,5}$/.test(filename)) throw badRequest("Invalid file name");

  const [entry, invoice, payment] = await Promise.all([
    prisma.expense.findFirst({ where: { screenshotPath: filename }, select: { businessId: true } }),
    // The original document, or the exact PDF emailed to the customer.
    prisma.invoice.findFirst({
      where: { OR: [{ doFilePath: filename }, { emailedPdfPath: filename }] },
      select: { businessId: true },
    }),
    prisma.payment.findFirst({ where: { proofPath: filename }, select: { invoice: { select: { businessId: true } } } }),
  ]);
  const businessId = entry?.businessId ?? invoice?.businessId ?? payment?.invoice.businessId;
  if (!businessId) throw notFound("That file");
  await assertBusinessAccess(user, businessId);

  // A file missing from storage (or storage being unreachable) is "not
  // available" to the person clicking the link, not a server crash.
  const result = await readUpload(filename).catch((e) => {
    console.error(`Couldn't read upload ${filename}:`, e);
    return null;
  });
  if (!result?.stream) throw new ApiError(404, "That file is no longer available");

  // The type comes from our own allow-list by extension — never from what was
  // stored — and anything that isn't a document or image is forced to
  // download. The sandbox CSP means that even a file that somehow slipped
  // through can't run script with this site's cookies.
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const safeType = SERVE_TYPES[ext];
  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": safeType ?? "application/octet-stream",
      "Content-Disposition": safeType ? "inline" : "attachment",
      // Chrome won't show a PDF under a sandbox policy; PDFs are verified by
      // their signature when stored, and render in the browser's own viewer.
      ...(safeType === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:" }),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
