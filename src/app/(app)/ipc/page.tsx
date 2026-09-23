import { VentureInvoiceList } from "@/components/VenturePages";
import { parseStatusFilter } from "@/components/InvoiceList";

export default async function IPCInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = parseStatusFilter((await searchParams).status);
  return <VentureInvoiceList venture="IPC" status={status} />;
}
