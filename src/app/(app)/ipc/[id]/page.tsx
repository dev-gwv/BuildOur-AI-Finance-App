import { VentureInvoiceDetail } from "@/components/VenturePages";

export default async function IPCInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VentureInvoiceDetail venture="IPC" id={id} />;
}
