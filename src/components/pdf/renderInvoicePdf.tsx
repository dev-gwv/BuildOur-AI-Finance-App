import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { AUTHORIZED_SIGNATURE_DATA_URI } from "@/lib/signatureImage";
import { InvoicePdf, type InvoicePdfData } from "./InvoicePdf";

/** Everything the PDF prints, read fresh from the database. Null if the invoice is gone. */
export async function loadInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null> {
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lines: { orderBy: { position: "asc" } },
        creditNotes: { orderBy: { noteDate: "asc" }, select: { number: true, noteDate: true, grossAmount: true } },
        payments: { select: { amount: true, kind: true, tdsAmount: true, method: true } },
      },
    }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" }, select: { signatureDataUri: true } }),
  ]);
  if (!invoice) return null;

  // Every invoice has lines since the line-items migration; the summary
  // columns are only a fallback for a row created by older code.
  const lines = invoice.lines.length
    ? invoice.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, qty: l.qty, grossAmount: l.grossAmount, gstPercent: l.gstPercent }))
    : [{ description: invoice.itemDescription, hsnSac: invoice.hsnSac, qty: invoice.qty, grossAmount: invoice.grossAmount, gstPercent: invoice.gstPercent }];

  return {
    brand: invoice.brand,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    cancelReason: invoice.cancelReason,
    customerName: invoice.customerName,
    customerAddress: invoice.customerAddress,
    customerGstin: invoice.customerGstin,
    placeOfSupply: invoice.placeOfSupply,
    notes: invoice.notes,
    terms: invoice.terms,
    doId: invoice.doId,
    saleType: invoice.saleType,
    downPayment: invoice.downPayment,
    financedAmount: invoice.financedAmount,
    revisedAt: invoice.revisedAt,
    lines,
    creditNotes: invoice.creditNotes,
    payments: invoice.payments,
    signatureDataUri: settings?.signatureDataUri || AUTHORIZED_SIGNATURE_DATA_URI,
  };
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf data={data} />);
}

/** A safe download name: "IPC-INV-002244.pdf", "IPC_26-27_0001.pdf". */
export function pdfFileName(invoiceNumber: string): string {
  return `${invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;
}
