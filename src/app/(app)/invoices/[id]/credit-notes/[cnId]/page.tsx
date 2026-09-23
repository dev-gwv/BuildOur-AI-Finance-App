import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/server/session";
import { canAccessBusiness } from "@/server/access";
import { creditNoteTax } from "@/server/services/creditNotes";
import { BRANDS } from "@/lib/brands";
import { AUTHORIZED_SIGNATURE_DATA_URI } from "@/lib/signatureImage";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency, formatDate } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * A credit note as a document the customer can be given: same seller header
 * as the invoice, "Credit Note" title, the original invoice it reduces, and
 * the tax split on the invoice's supply type.
 */
export default async function CreditNotePage({ params }: { params: Promise<{ id: string; cnId: string }> }) {
  const user = await requirePageUser();
  const { id, cnId } = await params;

  const [cn, settings] = await Promise.all([
    prisma.creditNote.findUnique({
      where: { id: cnId },
      include: {
        invoice: {
          select: {
            id: true,
            businessId: true,
            brand: true,
            invoiceNumber: true,
            invoiceDate: true,
            customerName: true,
            customerAddress: true,
            customerGstin: true,
            placeOfSupply: true,
          },
        },
      },
    }),
    prisma.invoiceSettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!cn || cn.invoiceId !== id || !(await canAccessBusiness(user, cn.invoice.businessId))) notFound();

  const inv = cn.invoice;
  const brand = BRANDS[inv.brand];
  const tax = creditNoteTax(cn, inv);
  const signature = settings?.signatureDataUri || AUTHORIZED_SIGNATURE_DATA_URI;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          eyebrow={
            <Link href={`/invoices/${inv.id}`} className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeft className="h-3 w-3" /> {inv.invoiceNumber}
            </Link>
          }
          title={`Credit note ${cn.number}`}
          description={`${inv.customerName} · ${formatDate(cn.noteDate)}`}
          actions={<PrintButton />}
        />
      </div>

      <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-card print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className={`px-8 py-7 text-white ${brand.headerClass}`}>
          <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${brand.accentTextClass}`}>Credit Note</p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{brand.name}</h1>
              {brand.addressLines.map((l) => (
                <p key={l} className="text-sm text-white/80">
                  {l}
                </p>
              ))}
              {brand.gstin && <p className="mt-1 text-sm text-white/80">GSTIN {brand.gstin}</p>}
            </div>
            <p className="text-2xl font-semibold tabular-nums">#{cn.number}</p>
          </div>
        </header>

        <div className="grid gap-6 px-8 py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Issued to</p>
            <p className="mt-1 font-semibold">{inv.customerName}</p>
            <p className="whitespace-pre-line text-sm text-neutral-600">{inv.customerAddress}</p>
            {inv.customerGstin && <p className="mt-1 text-sm text-neutral-600">GSTIN {inv.customerGstin}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm sm:justify-self-end">
            <dt className="text-neutral-500">Credit note date</dt>
            <dd className="text-right font-medium">{formatDate(cn.noteDate)}</dd>
            <dt className="text-neutral-500">Against invoice</dt>
            <dd className="text-right font-medium">{inv.invoiceNumber}</dd>
            <dt className="text-neutral-500">Invoice date</dt>
            <dd className="text-right font-medium">{formatDate(inv.invoiceDate)}</dd>
            <dt className="text-neutral-500">Place of supply</dt>
            <dd className="text-right font-medium">{inv.placeOfSupply || "—"}</dd>
          </dl>
        </div>

        <div className="px-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-3 pl-2 pr-2 font-semibold">Reason</th>
                <th className="py-3 pr-2 text-right font-semibold">Taxable</th>
                {brand.gstRegistered &&
                  (tax.taxMode === "IGST" ? (
                    <th className="py-3 pr-2 text-right font-semibold">IGST</th>
                  ) : (
                    <>
                      <th className="py-3 pr-2 text-right font-semibold">CGST</th>
                      <th className="py-3 pr-2 text-right font-semibold">SGST</th>
                    </>
                  ))}
                <th className="py-3 pr-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-100">
                <td className="py-4 pl-2 pr-2 align-top">{cn.reason}</td>
                <td className="py-4 pr-2 text-right align-top tabular-nums">{formatCurrency(tax.taxable)}</td>
                {brand.gstRegistered &&
                  (tax.taxMode === "IGST" ? (
                    <td className="py-4 pr-2 text-right align-top tabular-nums">
                      {formatCurrency(tax.igst)}
                      <br />
                      <span className="text-xs text-neutral-400">{cn.gstPercent}%</span>
                    </td>
                  ) : (
                    <>
                      <td className="py-4 pr-2 text-right align-top tabular-nums">
                        {formatCurrency(tax.cgst)}
                        <br />
                        <span className="text-xs text-neutral-400">{cn.gstPercent / 2}%</span>
                      </td>
                      <td className="py-4 pr-2 text-right align-top tabular-nums">
                        {formatCurrency(tax.sgst)}
                        <br />
                        <span className="text-xs text-neutral-400">{cn.gstPercent / 2}%</span>
                      </td>
                    </>
                  ))}
                <td className="py-4 pr-2 text-right align-top font-semibold tabular-nums">{formatCurrency(cn.grossAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-6 px-8 py-6">
          <p className="max-w-sm text-sm italic text-neutral-600">{amountInWords(cn.grossAmount)}</p>
          <div className="text-right">
            <p className="text-sm text-neutral-500">Total credited</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(cn.grossAmount)}</p>
          </div>
        </div>

        <footer className="flex justify-end border-t border-neutral-100 px-8 py-6">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signature} alt="Authorised signature" className="mx-auto h-14 object-contain" />
            <p className="mt-1 text-xs text-neutral-500">Authorised signatory · {brand.name}</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
