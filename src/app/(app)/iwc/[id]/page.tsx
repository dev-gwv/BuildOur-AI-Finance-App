import { VentureInvoiceDetail } from "@/components/VenturePages";

export default async function IWCInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VentureInvoiceDetail venture="IWC" id={id} />;
}
