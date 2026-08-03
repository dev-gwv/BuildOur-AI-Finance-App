"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" />
      Print / Save as PDF
    </Button>
  );
}
