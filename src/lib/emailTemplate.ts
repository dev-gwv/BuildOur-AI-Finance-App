import { BRANDS, type BrandKey } from "./brands";

export interface TemplateVars {
  customer_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total: string;
  balance_due: string;
  item: string;
  brand: string;
}

export const PLACEHOLDERS: Array<{ token: keyof TemplateVars; label: string }> = [
  { token: "customer_name", label: "Customer name" },
  { token: "invoice_number", label: "Invoice number" },
  { token: "total", label: "Invoice total" },
  { token: "balance_due", label: "Balance due" },
  { token: "invoice_date", label: "Invoice date" },
  { token: "due_date", label: "Due date" },
  { token: "item", label: "Item / description" },
  { token: "brand", label: "Business name" },
];

/** Starting wording per brand — the user can rewrite it in Invoice Settings. */
export const DEFAULT_TEMPLATES: Record<BrandKey, { subject: string; body: string }> = {
  GRATEFUL: {
    subject: "Tax Invoice {{invoice_number}} from {{brand}}",
    body: [
      "Dear {{customer_name}},",
      "",
      "Thank you for choosing {{brand}}.",
      "",
      "Please find your tax invoice {{invoice_number}} for {{item}}, dated {{invoice_date}}, for an amount of {{total}}. The full breakup is given below for your records.",
      "",
      "If you have any questions about this invoice, simply reply to this email and we will be happy to help.",
      "",
      "Warm regards,",
      "{{brand}}",
    ].join("\n"),
  },
  MULBERRY: {
    subject: "Invoice {{invoice_number}} from {{brand}}",
    body: [
      "Dear {{customer_name}},",
      "",
      "Thank you for trusting {{brand}} with your celebration. We are truly looking forward to being a part of your big day and capturing it beautifully for you.",
      "",
      "Please find your invoice {{invoice_number}} for {{item}}, dated {{invoice_date}}. The total is {{total}} and the balance currently outstanding is {{balance_due}}.",
      "",
      "If you have any questions, just reply to this email — we are always happy to help.",
      "",
      "Warm regards,",
      "{{brand}}",
    ].join("\n"),
  },
};

export function templateVars(input: {
  brand: BrandKey;
  customerName: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  dueDate: Date | string;
  total: number;
  balanceDue: number;
  itemDescription: string;
}): TemplateVars {
  const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
  const day = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return {
    customer_name: input.customerName,
    invoice_number: input.invoiceNumber,
    invoice_date: day.format(new Date(input.invoiceDate)),
    due_date: day.format(new Date(input.dueDate)),
    total: inr.format(input.total),
    balance_due: inr.format(Math.max(input.balanceDue, 0)),
    item: input.itemDescription,
    brand: BRANDS[input.brand].name,
  };
}

/** Fills {{placeholders}}; anything unrecognised is left alone rather than blanked. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? String(vars[key as keyof TemplateVars]) : whole
  );
}
