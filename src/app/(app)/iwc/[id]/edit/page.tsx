import { InvoiceEditPage } from "@/components/InvoiceEditPage";

export default async function EditIWCInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceEditPage id={id} section="IWC" />;
}
