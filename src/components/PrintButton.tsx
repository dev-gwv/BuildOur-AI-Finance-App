"use client";

import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Browser print of the on-screen invoice. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" />
      <span className="sr-only sm:not-sr-only">Print</span>
    </Button>
  );
}

/**
 * The real tax invoice PDF — the same file that's attached to emails —
 * downloaded straight from the server.
 */
export function DownloadPdfButton({ invoiceId }: { invoiceId: string }) {
  return (
    <a
      href={`/api/invoices/${invoiceId}/pdf?download=1`}
      className="inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 transition-all hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 active:scale-[0.98] sm:h-9 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 print:hidden"
    >
      <Download className="h-4 w-4" />
      <span>
        <span className="sm:hidden">PDF</span>
        <span className="hidden sm:inline">Download PDF</span>
      </span>
    </a>
  );
}
