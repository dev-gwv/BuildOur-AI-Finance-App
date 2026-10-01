"use client";

import { Field, Input } from "@/components/ui/Field";

/**
 * The dashboard's custom From/To dates. Rendered here, on the client, rather
 * than straight from the server page: Field ties its label to the input by
 * cloning the input, and an input element sent from a server component can
 * still be loading when the page hydrates, so the ids came out different.
 */
export function DateRangeFields({ from, to }: { from: string | null; to: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label="From">
        <Input type="date" name="from" defaultValue={from ?? ""} className="px-2.5" />
      </Field>
      <Field label="To">
        <Input type="date" name="to" defaultValue={to ?? ""} className="px-2.5" />
      </Field>
    </div>
  );
}
