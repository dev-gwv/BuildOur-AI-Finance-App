// Money-path self-check. Run: node src/lib/invoice.test.mjs
// Expected values are taken from the real reference invoice INV-002241,
// so a regression here means we'd bill a customer differently than before.
import assert from "node:assert/strict";
import { calculateInvoiceBreakup, totalsByPlatform } from "./invoiceCalc.ts";
import { amountInWords, numberToIndianWords } from "./numberToWords.ts";
import { looksLikeGstCertificate, parseGstCertificateText } from "./parseGstCertificate.ts";
import { parseDeliveryOrderText } from "./parseDeliveryOrder.ts";
import { looksLikeQuotation, parseQuotationText } from "./parseQuotation.ts";
import { PAYMENT_METHODS, parsePaymentScreenshotText } from "./parsePaymentScreenshot.ts";
import { invoiceEmailHtml, invoiceEmailSubject, invoiceEmailText } from "./invoiceEmail.ts";
import { isInterStateSupply, placeOfSupplyFromGstin, stateCodeFromGstin } from "./gstState.ts";
import { VENTURES, ledgerForInvoice, nextVentureInvoiceNumber, parseVenture } from "./ventures.ts";
import { calculateCostBreakup, calculateGatewayFee } from "./calc.ts";
import { detectGateway } from "./parsePaymentScreenshot.ts";
import { expenseSheetBody, paymentReceiptRow } from "./sheetRows.ts";
import { normalizeRazorpayPayment } from "./integrations/razorpayPayment.ts";
import { gstLine, gstPeriodRange, inputGst, monthlySummary, netGstPayable, sumLines } from "./gstReport.ts";

// --- GST back-calculation, matched against INV-002241 ---
const ref = calculateInvoiceBreakup({ grossAmount: 117999, gstPercent: 18, qty: 1 });
assert.equal(ref.subTotal, 99999.15, "subtotal");
assert.equal(ref.cgstAmount, 8999.92, "CGST");
assert.equal(ref.sgstAmount, 8999.92, "SGST");
assert.equal(ref.cgstPercent, 9, "CGST %");
assert.equal(ref.adjustment, 0.01, "rounding adjustment");
assert.equal(ref.total, 117999, "total");
// The parts must always add back up to what the customer pays. Rounded because
// summing the rounded parts in binary floating point lands a hair under.
assert.equal(
  Math.round((ref.subTotal + ref.cgstAmount + ref.sgstAmount + ref.adjustment) * 100) / 100,
  117999,
  "parts must reconcile to total"
);

// --- The other live products ---
for (const gross of [177000, 354000]) {
  const b = calculateInvoiceBreakup({ grossAmount: gross, gstPercent: 18, qty: 1 });
  assert.equal(b.cgstAmount, b.sgstAmount, "CGST and SGST must be equal");
  assert.equal(
    Math.round((b.subTotal + b.cgstAmount + b.sgstAmount + b.adjustment) * 100) / 100,
    gross,
    `parts must reconcile for ${gross}`
  );
}

// --- Inter-state supply: one IGST line at the full rate, same total ---
const igst = calculateInvoiceBreakup({ grossAmount: 117999, gstPercent: 18, qty: 1, isInterState: true });
assert.equal(igst.taxMode, "IGST", "inter-state is IGST");
assert.equal(igst.subTotal, ref.subTotal, "same taxable value either way");
assert.equal(igst.igstPercent, 18, "IGST at the full rate");
assert.equal(igst.igstAmount, 17999.85, "IGST amount");
assert.equal(igst.cgstAmount + igst.sgstAmount, 0, "no CGST/SGST on inter-state");
assert.equal(
  Math.round((igst.subTotal + igst.igstAmount + igst.adjustment) * 100) / 100,
  117999,
  "IGST parts must reconcile to total"
);
assert.equal(ref.taxMode, "CGST_SGST", "intra-state stays CGST+SGST");
assert.equal(ref.igstAmount, 0, "no IGST on intra-state");
assert.equal(noTaxMode(), "NONE", "no GST is NONE even if flagged inter-state");
function noTaxMode() {
  return calculateInvoiceBreakup({ grossAmount: 170000, gstPercent: 0, qty: 1, isInterState: true }).taxMode;
}

// --- Buyer state from the GSTIN's first two digits ---
assert.equal(stateCodeFromGstin("27AABCU9603R1ZM"), "27");
assert.equal(stateCodeFromGstin(" 07aajcg9243k1z5"), "07", "trimmed and case-insensitive");
assert.equal(stateCodeFromGstin(""), null);
assert.equal(stateCodeFromGstin("URP"), null, "unregistered marker has no state");
assert.equal(isInterStateSupply("07AAJCG9243K1Z5"), false, "Delhi buyer is intra-state");
assert.equal(isInterStateSupply("27AABCU9603R1ZM"), true, "Maharashtra buyer is inter-state");
assert.equal(isInterStateSupply(null), false, "B2C is intra-state");
assert.equal(placeOfSupplyFromGstin("27AABCU9603R1ZM"), "Maharashtra (27)");
assert.equal(placeOfSupplyFromGstin("99XXXX"), null, "unknown state code");

// --- Venture series: own prefix, own counter, never Grateful's INV- ---
assert.equal(nextVentureInvoiceNumber(VENTURES.IPC, null), "IPC-INV-002242", "IPC starts at 2242");
assert.equal(nextVentureInvoiceNumber(VENTURES.IWC, null), "IWC-INV-001001", "IWC starts at 1001");
assert.equal(nextVentureInvoiceNumber(VENTURES.IPC, "IPC-INV-002250"), "IPC-INV-002251");
assert.equal(nextVentureInvoiceNumber(VENTURES.IWC, "IWC-INV-001009"), "IWC-INV-001010");
assert.equal(
  nextVentureInvoiceNumber(VENTURES.IWC, "INV-002300"),
  "IWC-INV-001001",
  "a hand-typed number from another series doesn't advance this one"
);
assert.equal(parseVenture("IPC"), "IPC");
assert.equal(parseVenture("MULBERRY"), null, "Mulberry is a brand, not a venture");
assert.equal(parseVenture(null), null);
assert.equal(ledgerForInvoice({ brand: "MULBERRY", venture: null }), "MULBERRY");
assert.equal(ledgerForInvoice({ brand: "GRATEFUL", venture: "IWC" }), "IWC");
assert.equal(ledgerForInvoice({ brand: "GRATEFUL", venture: null }), null, "legacy Grateful has no sheet");

// --- Indian-format number words ---
assert.equal(numberToIndianWords(117999), "One Lakh Seventeen Thousand Nine Hundred Ninety-Nine");
assert.equal(numberToIndianWords(177000), "One Lakh Seventy-Seven Thousand");
assert.equal(numberToIndianWords(354000), "Three Lakh Fifty-Four Thousand");
assert.equal(numberToIndianWords(0), "Zero");
assert.equal(numberToIndianWords(10000000), "One Crore");
assert.match(amountInWords(117999), /^Indian Rupee .* Only$/);

// --- DO "Product Price" parsing, across the formats Bajaj uses ---
const priceRe = /Product Price\s*([\d,]+(?:\.\d{1,2})?)/;
const parsePrice = (s) => {
  const m = priceRe.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
assert.equal(parsePrice("A Product Price 117,999.00 117,999.00"), 117999);
assert.equal(parsePrice("A Product Price 1,77,000 1,77,000"), 177000);
assert.equal(parsePrice("A Product Price 354000 354000"), 354000);

// --- GST certificate (Form GST REG-06) extraction ---
// Text flattened the same way the PDF reader flattens it.
const gstText = (
  "Form GST REG-06 [See Rule 10(1)] Registration Certificate " +
  "Registration Number : 27AABCU9603R1ZM " +
  "1. Legal Name ACME TECHNOLOGIES PRIVATE LIMITED " +
  "2. Trade Name, if any ACME TECH " +
  "3. Constitution of Business Private Limited Company " +
  "4. Address of Principal Place of Business 501, 5th Floor, Tower B, Cyber Heights, Andheri East, Mumbai, Maharashtra, 400069 " +
  "5. Date of Liability 01/07/2017 " +
  "6. Period of Validity From 01/07/2017 To Not Applicable " +
  "7. Type of Registration Regular"
).replace(/\s+/g, " ");

const gst = parseGstCertificateText(gstText);
assert.equal(gst.gstin, "27AABCU9603R1ZM", "GSTIN");
assert.equal(gst.legalName, "ACME TECHNOLOGIES PRIVATE LIMITED", "legal name");
assert.equal(gst.tradeName, "ACME TECH", "trade name");
assert.match(gst.address, /Cyber Heights.*400069$/, "address");
assert.ok(looksLikeGstCertificate(gstText), "should detect a GST certificate");

// A certificate with no trade name must not swallow the next label.
const noTrade = parseGstCertificateText(
  "Registration Certificate Registration Number : 07AAJCG9243K1Z5 " +
    "1. Legal Name SOME FIRM 2. Trade Name, if any 3. Constitution of Business Proprietorship"
);
assert.equal(noTrade.legalName, "SOME FIRM", "legal name without trade name");
assert.equal(noTrade.gstin, "07AAJCG9243K1Z5", "GSTIN without trade name");

// --- The two document types must not be confused with each other ---
const doText =
  "Bajaj Finance Limited DELIVERY ORDER DO ID: B429427477 A Product Price 117,999.00 117,999.00";
assert.equal(parseDeliveryOrderText(doText).productPrice, 117999, "DO still parses");
assert.equal(parseDeliveryOrderText(doText).doId, "B429427477", "DO id still parses");
assert.ok(!/GST REG/i.test(doText), "DO sample has no GST markers");

// --- Mulberry: unregistered seller, so no tax is added ---
const noTax = calculateInvoiceBreakup({ grossAmount: 170000, gstPercent: 0, qty: 1 });
assert.equal(noTax.subTotal, 170000, "sub total equals total when no GST");
assert.equal(noTax.cgstAmount, 0, "no CGST");
assert.equal(noTax.sgstAmount, 0, "no SGST");
assert.equal(noTax.adjustment, 0, "no rounding adjustment");
assert.equal(numberToIndianWords(170000), "One Lakh Seventy Thousand");

// --- Mulberry quotation extraction, matched to the reference deck ---
const quoteText = (
  "The Mulberry Weddings Timeless Memories For Lifetime Events " +
  "Event : Carnival Haldi (Both side) Location: Jim Corbett Event : Carnival Haldi Location: Jim Corbett Date : 19 Feb 2027 " +
  "Event : Vidai ( Morning ) Location: Jim Corbett Event : Vidai Location: Jim Corbett Date : 21 Feb 2027 " +
  "Deliverables Total Investment: INR 1,70,000/- (Team Food & Accommodation will be managed by the client.)"
).replace(/\s+/g, " ");

const quote = parseQuotationText(quoteText, "Aman & Ruchika Wedding Package (1).pdf");
assert.ok(looksLikeQuotation(quoteText), "should detect a quotation");
assert.equal(quote.totalAmount, 170000, "total investment");
assert.equal(quote.clientName, "Aman & Ruchika", "client name from file name");
assert.equal(quote.firstEventDate, "2027-02-19", "first event date");
// The same event appears twice per slide with a different suffix — keep one.
assert.deepEqual(quote.events, ["Carnival Haldi (Both side)", "Vidai ( Morning )"], "deduped events");

// Balance owed is whatever the payments don't cover.
const paid = [50000, 20000].reduce((a, b) => a + b, 0);
assert.equal(Math.round((170000 - paid) * 100) / 100, 100000, "balance after part payments");

// --- What arrived on each platform ---
const split = totalsByPlatform([
  { amount: 50000, method: "PhonePe" },
  { amount: 20000, method: "GPay" },
  { amount: 30000, method: "PhonePe" },
  { amount: 5000, method: null },
  { amount: 2500, method: "  " },
]);
assert.deepEqual(
  split,
  [
    ["PhonePe", 80000],
    ["GPay", 20000],
    ["Not recorded", 7500],
  ],
  "instalments group by platform, largest first"
);
// Every rupee taken must survive the grouping, or the split silently disagrees
// with the Received figure sitting right above it.
assert.equal(
  split.reduce((sum, [, amt]) => sum + amt, 0),
  107500,
  "platform split must reconcile to the total received"
);
// Paise must not drift when instalments accumulate.
assert.deepEqual(
  totalsByPlatform([
    { amount: 0.1, method: "GPay" },
    { amount: 0.2, method: "GPay" },
  ]),
  [["GPay", 0.3]],
  "no floating-point drift across instalments"
);
assert.deepEqual(totalsByPlatform([]), [], "no payments means no platform rows");

// --- Payment screenshot reading (OCR output is messy, so be forgiving) ---
const phonepe = parsePaymentScreenshotText(
  "PhonePe Payment Successful ₹10,000 To The Mulberry Weddings 12 Aug 2026 UPI Transaction ID T2608121234567890"
);
assert.equal(phonepe.amount, 10000, "PhonePe amount");
assert.equal(phonepe.method, "PhonePe", "PhonePe detected");
assert.equal(phonepe.paidOn, "2026-08-12", "PhonePe date");
assert.equal(phonepe.reference, "T2608121234567890", "PhonePe reference");

const gpay = parsePaymentScreenshotText("Google Pay ₹1,60,000 Completed 20/08/2026 UPI transaction ID 987654321012");
assert.equal(gpay.amount, 160000, "GPay amount");
assert.equal(gpay.method, "GPay", "GPay detected");
assert.equal(gpay.paidOn, "2026-08-20", "GPay numeric date");

// "Rs." with no symbol, and Paytm.
const paytm = parsePaymentScreenshotText("Paytm Paid Rs. 25000 successfully");
assert.equal(paytm.amount, 25000, "Paytm amount");
assert.equal(paytm.method, "Paytm", "Paytm detected");

// Nothing recognisable must not invent a value.
const junk = parsePaymentScreenshotText("blurry screenshot with no useful text");
assert.equal(junk.amount, null, "no amount invented");
assert.equal(junk.method, null, "no method invented");

// --- What OCR really returns for "₹" ---
// Tesseract's English alphabet has no ₹, so it never comes back. The strings
// below are verbatim OCR output for PhonePe, GPay and Paytm receipts, with the
// line the figure was printed largest on — the symbol reads as "%", as its own
// "X", and, on the GPay receipt, as a "3" glued to the figure. Getting these
// wrong is what had the amount being retyped by hand for every payment.
const ocr = [
  [
    "Payment Successful %1,70,000 Paid to The Mulberry Weddings Transaction ID" +
      " T2608121234567890 UTR 521834765412 Debited from XXXXXX4521 15 Aug 2026, 4:12 PM",
    "%1,70,000",
    170000,
  ],
  [
    "Completed 344,000 To The Mulberry Weddings 13 Aug 2026, 11:04 am From HDFC" +
      " Bank 8842 UPI transaction ID 487561239045 Google Pay",
    "344,000",
    44000,
  ],
  [
    "Payment Successful X 39,500.00 Paid to The Mulberry Weddings 03 Aug 2026" +
      " UPI Ref No: 561203948877 Paytm UPI Bank Balance %2,14,880",
    "X 39,500.00",
    39500,
  ],
];
for (const [text, amountLine, expected] of ocr) {
  assert.equal(parsePaymentScreenshotText(text, amountLine).amount, expected, `OCR amount ${expected}`);
}

// A figure that came with a symbol is never trimmed: ₹1,70,000 written the
// western way is 170000, not 70000.
assert.equal(parsePaymentScreenshotText("", "₹170,000").amount, 170000, "western grouping kept");
assert.equal(parsePaymentScreenshotText("", "Rs 44,000").amount, 44000, "spelt-out symbol kept");
// The balance printed under the amount must never be mistaken for it.
assert.equal(
  parsePaymentScreenshotText("Bank Balance ₹2,14,880 Paid ₹5,000 to The Mulberry Weddings").amount,
  5000,
  "balance is not the payment"
);
// Timestamps and dates are numbers too.
assert.equal(parsePaymentScreenshotText("no money here", "11:04 am").amount, null, "a time is not an amount");
assert.equal(
  parsePaymentScreenshotText("UPI Ref No: 561203948877 only").amount,
  null,
  "a reference number is not an amount"
);

// A platform a screenshot can fill in must also be one the user could have
// picked. If the two lists drift, the same platform's takings split across two
// spellings and the per-platform totals quietly stop adding up.
assert.equal(new Set(PAYMENT_METHODS).size, PAYMENT_METHODS.length, "no duplicate platforms");
for (const detected of [phonepe.method, gpay.method, paytm.method]) {
  assert.ok(PAYMENT_METHODS.includes(detected), `${detected} must be an offered platform`);
}
const bank = parsePaymentScreenshotText("NEFT credited to your account Rs. 50000");
assert.equal(bank.method, "Bank transfer", "NEFT reads as a bank transfer");
assert.ok(PAYMENT_METHODS.includes(bank.method), "bank transfer must be an offered platform");

// --- Invoice email renders for both brands ---
for (const brand of ["GRATEFUL", "MULBERRY"]) {
  const data = {
    brand,
    invoiceNumber: "INV-000001",
    customerName: "Test <script>",
    invoiceDate: "2026-08-06",
    dueDate: "2026-08-06",
    itemDescription: "Wedding Package",
    total: 170000,
    amountPaid: 10000,
    notes: "Thanks!",
    terms: "Terms here",
  };
  const html = invoiceEmailHtml(data);
  assert.ok(html.includes("INV-000001"), `${brand}: invoice number in email`);
  assert.ok(html.includes("1,60,000"), `${brand}: balance in email`);
  assert.ok(!html.includes("<script>"), `${brand}: customer name must be escaped`);
  assert.ok(invoiceEmailSubject(data).includes("INV-000001"), `${brand}: subject`);
  assert.ok(invoiceEmailText(data).includes("Balance due"), `${brand}: plain-text part`);
}
// An unregistered seller must not leak GST wording into the email.
assert.ok(!/GSTIN/.test(invoiceEmailHtml({
  brand: "MULBERRY", invoiceNumber: "X", customerName: "A", invoiceDate: "2026-08-06",
  dueDate: "2026-08-06", itemDescription: "Y", total: 100, amountPaid: 0,
})), "no GSTIN on Mulberry email");

// --- Razorpay: commission plus 18% GST on the commission, not on the payment ---
const rzp = calculateGatewayFee(10000, 2, 18);
assert.equal(rzp.feeAmount, 200, "2% commission");
assert.equal(rzp.feeGstAmount, 36, "GST on the commission only");
assert.equal(rzp.netAmount, 9764, "what settles into the bank");
assert.equal(calculateGatewayFee(10000, 0, 18).netAmount, 10000, "no fee, full amount");

assert.deepEqual(detectGateway("Payment successful pay_29QQoUBi66xm2f Razorpay"), {
  gateway: "Razorpay",
  gatewayRef: "pay_29QQoUBi66xm2f",
});
assert.equal(detectGateway("Paid to ACME via Razorpay").gateway, "Razorpay", "named without an id");
assert.equal(detectGateway("PhonePe Paid to Shabreen ₹44,000").gateway, null, "a plain UPI receipt has no gateway");
const rzpShot = parsePaymentScreenshotText("PhonePe Transaction Successful ₹ 10,000 Paid to ACME pay_29QQoUBi66xm2f", "₹ 10,000");
assert.equal(rzpShot.method, "PhonePe", "the UPI app it was paid from still wins");
assert.equal(rzpShot.gateway, "Razorpay", "and the gateway is recognised alongside it");
assert.equal(parsePaymentScreenshotText("Razorpay Payment ID pay_29QQoUBi66xm2f ₹5,000", "₹5,000").method, "Razorpay");

// --- Money out: GST backed out of a GST-inclusive cost ---
const cost = calculateCostBreakup({ grossAmount: 1180, gstPercent: 18 });
assert.equal(cost.netAmount, 1000, "cost excluding GST");
assert.equal(cost.gstAmount, 180, "input GST");

// --- Sheet rows: what each record writes ---
const row = paymentReceiptRow(
  { id: "p1", amount: 118000, paidOn: new Date("2026-09-11T00:00:00Z"), method: "PhonePe", note: null, gateway: "Razorpay", feeAmount: 2360, feeGstAmount: 424.8 },
  { brand: "GRATEFUL", venture: "IWC", customerName: "Harshil Tanwar", invoiceNumber: "IWC-INV-001001", gstPercent: 18 }
);
assert.equal(row.date, "2026-09-11");
assert.equal(row.amount, 118000, "the sheet's 'including GST & charges' is what the customer paid");
assert.equal(row.amountExGst, 97640, "excluding: minus gateway fee + its GST, then GST backed out");
assert.match(row.remarks, /PhonePe · via Razorpay · Razorpay fee ₹2,784\.8 · IWC-INV-001001/);
const mulberryRow = paymentReceiptRow(
  { id: "p2", amount: 44000, paidOn: new Date("2026-09-12T00:00:00Z"), method: "GPay", note: null, gateway: null, feeAmount: 0, feeGstAmount: 0 },
  { brand: "MULBERRY", venture: null, customerName: "Aman", invoiceNumber: "INV-001121", gstPercent: 18 }
);
assert.equal(mulberryRow.amountExGst, 44000, "Mulberry charges no GST");
const expenseBase = { id: "e1", date: new Date("2026-09-13T00:00:00Z"), description: null, grossAmount: 1180, netAmount: 1000, category: { name: "Rent" }, gateway: null };
assert.equal(expenseSheetBody({ ...expenseBase, direction: "OUT" }).action, "upsertExpense", "money out goes to expenses");
assert.equal(expenseSheetBody({ ...expenseBase, direction: "IN" }).action, "upsert", "money in goes to receipts");

// --- GST report: output tax per invoice, reconciled per month and B2B/B2C ---
const gstBase = { qty: 1, gstPercent: 18, placeOfSupply: "", venture: "IPC", customerName: "x" };
const lines = [
  gstLine({ ...gstBase, id: "a", invoiceNumber: "A", invoiceDate: new Date(2026, 8, 5), customerGstin: "07AAJCG9243K1Z5", grossAmount: 117999 }),
  gstLine({ ...gstBase, id: "b", invoiceNumber: "B", invoiceDate: new Date(2026, 8, 20), customerGstin: "27AABCU9603R1ZM", grossAmount: 117999 }),
  gstLine({ ...gstBase, id: "c", invoiceNumber: "C", invoiceDate: new Date(2026, 9, 2), customerGstin: null, grossAmount: 177000 }),
];
assert.equal(lines[0].cgst, 8999.92, "Delhi buyer: CGST");
assert.equal(lines[0].igst, 0, "Delhi buyer: no IGST");
assert.equal(lines[1].igst, 17999.85, "Maharashtra buyer: IGST");
assert.equal(lines[1].cgst + lines[1].sgst, 0, "Maharashtra buyer: no CGST/SGST");
assert.equal(lines[2].b2b, false, "no GSTIN is B2C");
assert.ok(lines[2].cgst > 0 && lines[2].igst === 0, "B2C is intra-state");
for (const l of lines) {
  assert.equal(Math.round((l.taxable + l.tax + l.adjustment) * 100) / 100, l.value, `${l.invoiceNumber} reconciles`);
}
const gstTotal = sumLines(lines);
assert.equal(gstTotal.count, 3);
assert.equal(gstTotal.value, 412998, "invoice value total");
assert.equal(gstTotal.igst, 17999.85);
assert.equal(gstTotal.cgst, gstTotal.sgst, "CGST and SGST always match");
const byMonth = monthlySummary(lines);
assert.deepEqual(byMonth.map((m) => m.month), ["2026-09", "2026-10"], "grouped by invoice month");
assert.equal(byMonth[0].b2b.count, 2, "September: both B2B");
assert.equal(byMonth[1].b2c.count, 1, "October: the B2C sale");
assert.equal(
  Math.round((byMonth[0].all.tax + byMonth[1].all.tax) * 100) / 100,
  gstTotal.tax,
  "months add up to the period"
);
const itc = inputGst([180, 90], [36]);
assert.equal(itc.total, 306, "costs + gateway-fee GST");
assert.equal(netGstPayable(gstTotal, itc), Math.round((gstTotal.tax - 306) * 100) / 100);
const fy = gstPeriodRange("fy", new Date(2026, 1, 10));
assert.equal(fy.start.getFullYear(), 2025, "Feb 2026 is in FY 2025-26");
assert.equal(fy.start.getMonth(), 3, "FY starts in April");
const q = gstPeriodRange("quarter", new Date(2026, 8, 23));
assert.equal(q.start.getMonth(), 6, "Sep is in the Jul–Sep quarter");

// --- Razorpay API: amounts in paise, and `fee` already includes `tax` ---
const api = normalizeRazorpayPayment({
  id: "pay_29QQoUBi66xm2f", status: "captured", amount: 1000000, fee: 23600, tax: 3600,
  method: "upi", created_at: 1789000000, vpa: "a@okhdfc", acquirer_data: { rrn: "123456789012" },
});
assert.equal(api.amount, 10000, "paise to rupees");
assert.equal(api.feeAmount, 200, "commission excluding its GST");
assert.equal(api.feeGstAmount, 36, "GST on the commission");
assert.equal(api.netAmount, 9764, "settled amount");
assert.equal(api.reference, "123456789012");
assert.match(api.paidOn, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(normalizeRazorpayPayment({ id: "pay_x", status: "captured", amount: 500, created_at: 1789000000 }).feeAmount, 0, "no fee reported yet");

console.log("All invoice money-path checks passed.");
