import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readUpload } from "@/lib/storage";
import { badRequest, notFound, withApiErrors } from "@/server/errors";
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
    prisma.invoice.findFirst({ where: { doFilePath: filename }, select: { businessId: true } }),
    prisma.payment.findFirst({ where: { proofPath: filename }, select: { invoice: { select: { businessId: true } } } }),
  ]);
  const businessId = entry?.businessId ?? invoice?.businessId ?? payment?.invoice.businessId;
  if (!businessId) throw notFound("That file");
  await assertBusinessAccess(user, businessId);

  const result = await readUpload(filename);
  if (!result?.stream) throw notFound("That file");

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      // Uploads are limited to PDFs and images; never let a browser guess otherwise.
      "X-Content-Type-Options": "nosniff",
    },
  });
});
