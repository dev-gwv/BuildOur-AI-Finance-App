// Pure: what each record looks like as a sheet row. Kept apart from the
// network and database code in sheet.ts so it can be checked in isolation.

export type ReceiptRow = {
  id: string;
  /** YYYY-MM-DD — the sheet files rows into the month's tab by this. */
  date: string;
  client: string;
  /** What the customer paid, GST and gateway charges included. */
  amount: number;
  /** For the ventures' "Excluding Gst & Charges" column; ignored where a workbook has none. */
  amountExGst: number;
  remarks: string;
};

export type CostRow = {
  id: string;
  date: string;
  particular: string;
  amount: number;
  amountExGst: number;
};

export type SheetBody =
  | ({ action: "upsert" } & ReceiptRow)
  | { action: "remove"; id: string }
  | ({ action: "upsertExpense" } & CostRow)
  | { action: "removeExpense"; id: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

type PaymentForSheet = {
  id: string;
  amount: number;
  paidOn: Date;
  method: string | null;
  note: string | null;
  gateway: string | null;
  feeAmount: number;
  feeGstAmount: number;
};
type InvoiceForSheet = { brand: string; customerName: string; invoiceNumber: string; gstPercent: number };

export function paymentReceiptRow(payment: PaymentForSheet, invoice: InvoiceForSheet): ReceiptRow {
  const fees = payment.feeAmount + payment.feeGstAmount;
  const settled = payment.amount - fees;
  // Only Grateful's ventures charge GST; Mulberry's "excluding" is just net of charges.
  const gst = invoice.brand === "GRATEFUL" ? invoice.gstPercent : 0;
  return {
    id: payment.id,
    date: isoDate(payment.paidOn),
    client: invoice.customerName,
    amount: payment.amount,
    amountExGst: round2(settled / (1 + gst / 100)),
    remarks: [
      payment.method,
      payment.gateway && payment.gateway !== payment.method ? `via ${payment.gateway}` : null,
      fees > 0 ? `${payment.gateway ?? "gateway"} fee ₹${round2(fees).toLocaleString("en-IN")}` : null,
      payment.note,
      invoice.invoiceNumber,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

type ExpenseForSheet = {
  id: string;
  date: Date;
  direction: string;
  description: string | null;
  grossAmount: number;
  netAmount: number;
  category: { name: string };
  gateway: { name: string } | null;
};

/** Money in goes to the receipts table, money out to the expenses table. */
export function expenseSheetBody(expense: ExpenseForSheet): SheetBody {
  const label = expense.description || expense.category.name;
  if (expense.direction === "OUT") {
    return {
      action: "upsertExpense",
      id: expense.id,
      date: isoDate(expense.date),
      particular: label,
      amount: expense.grossAmount,
      amountExGst: expense.netAmount,
    };
  }
  return {
    action: "upsert",
    id: expense.id,
    date: isoDate(expense.date),
    client: label,
    amount: expense.grossAmount,
    amountExGst: expense.netAmount,
    remarks: [expense.gateway?.name, expense.category.name].filter(Boolean).join(" · "),
  };
}

