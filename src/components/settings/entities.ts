import { BRANDS, type BrandKey } from "@/lib/brands";
import type { EntityOption } from "./BusinessProfileForm";

/** The legal entities a business can bill as, described the way the invoice will print them. */
export const ENTITY_OPTIONS: EntityOption[] = (Object.keys(BRANDS) as BrandKey[]).map((key) => {
  const b = BRANDS[key];
  return {
    key,
    name: b.name,
    gstRegistered: b.gstRegistered,
    detail: b.gstRegistered
      ? `GST-registered (${b.gstin}). Prints a Tax Invoice with CGST+SGST or IGST, and its bank details.`
      : "Not GST-registered. Prints a plain Invoice with no tax breakup.",
  };
});

export const entityName = (key: string) => BRANDS[key as BrandKey]?.name ?? key;
