import { NextRequest, NextResponse } from "next/server";
import { notFound, withApiErrors } from "@/server/errors";
import { requireUser } from "@/server/session";
import { requireInvoiceAccess } from "@/server/access";
import { loadInvoicePdfData, pdfFileName, renderInvoicePdf } from "@/components/pdf/renderInvoicePdf";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/invoices/[id]/pdf — the invoice as a PDF, access-checked like the
 * invoice page. Opens in the browser; `?download=1` saves it instead.
 */
export const GET = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await requireInvoiceAccess(user, id);

  const data = await loadInvoicePdfData(id);
  if (!data) throw notFound("That invoice");
  const pdf = await renderInvoicePdf(data);

  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdfFileName(data.invoiceNumber)}"`,
      // Always the current state of the invoice (payments, credit notes).
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
