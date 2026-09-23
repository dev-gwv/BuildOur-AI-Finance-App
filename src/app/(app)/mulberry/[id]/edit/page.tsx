import { InvoiceEditPage } from "@/components/InvoiceEditPage";

export default async function EditMulberryInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceEditPage id={id} section="MULBERRY" />;
}
