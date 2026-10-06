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
import { guessStateCodeFromAddress, isInterStateSupply, placeOfSupplyFromGstin, stateCodeFromGstin, stateCodeFromPlaceOfSupply } from "./gstState.ts";
import { formatInvoiceNumber, fyLabel, longestNumberFor, previewInvoiceNumber, resolvePrefix, seqInSeries, slugify } from "./invoiceNumbering.ts";
import { computeInvoice, invoiceBalance, invoiceSummaryFields } from "./invoiceLines.ts";
import { calculateBreakup, calculateCostBreakup, calculateGatewayFee } from "./calc.ts";
import { detectGateway } from "./parsePaymentScreenshot.ts";
import { expenseSheetBody, paymentReceiptRow } from "./sheetRows.ts";
import { chargesCollected, expectedBajajDeduction, pickDoDetails } from "./bajajDo.ts";
import { matchRazorpayPayment, normalizeRazorpayPayment } from "./integrations/razorpayPayment.ts";
import { normalizeTagMangoHost, normalizeTagMangoTransaction } from "./integrations/tagmangoPayment.ts";
import { gstCreditLine, gstLine, gstPeriodRange, hsnSummary, inputGst, monthlySummary, netGstPayable, netOfCredits, sumLines } from "./gstReport.ts";

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

// --- Business invoice series: prefix + 6-digit counter ---
assert.equal(formatInvoiceNumber("IPC-INV-", 2242), "IPC-INV-002242", "IPC continues from 2242");
assert.equal(previewInvoiceNumber({ invoicePrefix: "IWC-INV-", invoiceNextNumber: 1001 }), "IWC-INV-001001");
assert.equal(seqInSeries("IPC-INV-002250", "IPC-INV-"), 2250);
assert.equal(seqInSeries("ipc-inv-002250", "IPC-INV-"), 2250, "case-insensitive prefix");
assert.equal(seqInSeries("INV-002300", "IWC-INV-"), null, "another series doesn't count");
assert.equal(seqInSeries("INV-001121", "INV-"), 1121, "Mulberry keeps the plain INV- series");
assert.equal(slugify("The Mulberry Weddings"), "the-mulberry-weddings");
assert.equal(slugify("  IPC Finance!! "), "ipc-finance");
assert.equal(slugify("!!!"), "business", "never empty");

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
// --- Ways ₹15,000 used to come out as ₹1,50,000 ---
const shot = (text, line) => parsePaymentScreenshotText(text, line);
// A bank SMS: nothing printed bigger, so the "largest" line was the balance.
assert.equal(shot("Rs.15000.00 credited to A/c XX1234 on 01-10-26 by UPI ref 627512345678. Avl Bal Rs.150000.00", "Avl Bal Rs.150000.00").amount, 15000, "SMS: the balance line is not the amount");
// The decimal point lost from "15,000.0": the text's own figure wins.
assert.equal(shot("Received ₹15,000.0 from Ajay Pal Singh", "₹15,0000").amount, 15000, "lost decimal point (×10)");
assert.equal(shot("Amount credited Rs 15,000 to your account", "1500000").amount, 15000, "lost decimal point (×100)");
// A doubled zero with nothing to check it against is kept, but flagged.
const doubled = shot("₹15,0000", "₹15,0000");
assert.equal(doubled.amountUncertain, true, "an impossibly grouped figure is flagged for checking");
// "+₹15,000" on a credit: the plus isn't the rupee sign, the glued 2 is.
assert.equal(shot("+215,000 Received from Ajay", "+215,000").amount, 15000, "₹ read as a digit after a plus sign");
// "₹15000" read as "215000": only fixable when the text states the amount.
assert.equal(shot("215000 Paid to ACME Amount Rs 15000", "215000").amount, 15000, "₹ read as a leading digit, ungrouped");
// Letters among the digits.
assert.equal(shot("", "₹15,0O0").amount, 15000, "O read for 0");
assert.equal(shot("", "₹1l,500").amount, 11500, "l read for 1");
// Correct figures stay correct, and aren't flagged.
assert.equal(shot("Paid ₹1,50,000 to ACME", "₹1,50,000").amount, 150000, "a real ₹1,50,000 is left alone");
assert.equal(shot("Paid ₹1,50,000 to ACME", "₹1,50,000").amountUncertain, false);
// A fee or cashback printed with the payment is not the payment.
assert.equal(shot("Cashback ₹50 Paid ₹5,000 to ACME").amount, 5000, "cashback is not the payment");

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
assert.equal(row.amountExGst, 97215.2, "excluding: GST backed out of the whole amount, then the gateway fee + its GST off it");

// --- The client's worked example: ₹5,000 through Razorpay at 2.1% ---
const fiveK = paymentReceiptRow(
  { id: "p5", amount: 5000, paidOn: new Date("2026-10-01T00:00:00Z"), method: "Razorpay", note: null, gateway: "Razorpay", feeAmount: 105, feeGstAmount: 18.9 },
  { brand: "GRATEFUL", customerName: "Example", invoiceNumber: "IPC-INV-1", gstPercent: 18 }
);
assert.equal(fiveK.amountExCharges, 4876.1, "₹5,000 less Razorpay's ₹123.90");
assert.equal(fiveK.amountExGst, 4113.39, "₹5,000 − ₹762.71 GST − ₹123.90 Razorpay");
const entry5k = calculateBreakup({ grossAmount: 5000, gatewayChargePercent: 2.1, gstPercent: 18 });
assert.equal(entry5k.gstAmount, 762.71, "money-in entry: GST inside the gross");
assert.equal(entry5k.gatewayChargeAmount, 105, "charge on the gross");
assert.equal(entry5k.netAmount, 4132.29, "net = gross − GST − charge");
assert.match(row.remarks, /PhonePe · via Razorpay · Razorpay fee ₹2,784\.8 · IWC-INV-001001/);
const mulberryRow = paymentReceiptRow(
  { id: "p2", amount: 44000, paidOn: new Date("2026-09-12T00:00:00Z"), method: "GPay", note: null, gateway: null, feeAmount: 0, feeGstAmount: 0 },
  { brand: "MULBERRY", venture: null, customerName: "Aman", invoiceNumber: "INV-001121", gstPercent: 18 }
);
assert.equal(mulberryRow.amountExGst, 44000, "Mulberry charges no GST");
const expenseBase = { id: "e1", date: new Date("2026-09-13T00:00:00Z"), description: null, grossAmount: 1180, gatewayChargeAmount: 0, netAmount: 1000, category: { name: "Rent" }, gateway: null };
assert.equal(expenseSheetBody({ ...expenseBase, direction: "OUT" }).action, "upsertExpense", "money out goes to expenses");
assert.equal(expenseSheetBody({ ...expenseBase, direction: "IN" }).action, "upsert", "money in goes to receipts");

// --- GST report: output tax per invoice, reconciled per month and B2B/B2C ---
const gstBase = { qty: 1, gstPercent: 18, placeOfSupply: "", business: "IPC Finance", customerName: "x" };
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

// --- A Razorpay payment recorded without its pay_ id, found by amount and date ---
const rp = (id, amount, paidOn, status = "captured") => ({ id, amount, paidOn, status, feeAmount: 100, feeGstAmount: 18 });
const pool = [rp("pay_A", 4999, "2026-10-01"), rp("pay_B", 4999, "2026-10-02"), rp("pay_C", 9999, "2026-10-01"), rp("pay_D", 20000, "2026-10-01", "failed")];
assert.equal(matchRazorpayPayment(pool, 9999, "2026-10-01")?.id, "pay_C", "one payment of that amount");
assert.equal(matchRazorpayPayment(pool, 9999, "2026-10-02")?.id, "pay_C", "entered the next morning");
assert.equal(matchRazorpayPayment(pool, 9999, "2026-10-04"), null, "too far apart");
assert.equal(matchRazorpayPayment(pool, 4999, "2026-10-01")?.id, "pay_A", "two near, one that day");
assert.equal(matchRazorpayPayment([...pool, rp("pay_E", 4999, "2026-10-01")], 4999, "2026-10-01"), null, "two that day: never guessed");
assert.equal(matchRazorpayPayment(pool, 4999, "2026-10-01", new Set(["pay_A"]))?.id, "pay_B", "an id already recorded is skipped");
assert.equal(matchRazorpayPayment(pool, 20000, "2026-10-01"), null, "failed payments don't count");

// --- TagMango: its documented transaction, as the app records it ---
const tm = normalizeTagMangoTransaction({
  id: "66f3a1c4d9f135a7b2c3d4e5", occurredAt: "2026-08-24T20:02:41.517Z", status: "completed",
  customer: { name: "John Doe", email: "john.doe@example.com", phone: 1234567890 },
  mango: { title: "Introduction to Coding" },
  payment: { type: "onetime", chargedAmount: 4999, currency: "INR", gstAmount: 762.56 },
  commission: { totalAmountIncludingGst: 499.9, reportedGstAmount: 89.98 },
  refund: { amount: 0 },
});
assert.equal(tm.status, "captured", "completed reads like a captured Razorpay payment");
assert.equal(tm.amount, 4999);
assert.equal(tm.gstAmount, 762.56, "GST inside the amount, as TagMango reports it");
assert.equal(tm.feeAmount, 409.92, "commission excluding its GST");
assert.equal(tm.feeGstAmount, 89.98);
assert.equal(tm.paidOn, "2026-08-25", "IST date: 8 pm UTC is past midnight in India");
assert.equal(tm.contact, "1234567890");
assert.equal(tm.name, "John Doe");
assert.equal(tm.description, "Introduction to Coding");
assert.equal(normalizeTagMangoHost("https://Learn.Example.com/dashboard?x=1"), "learn.example.com");
assert.equal(normalizeTagMangoHost("not a host"), null);
const tmRow = paymentReceiptRow(
  { id: "p11", amount: 4999, paidOn: new Date("2026-08-25T00:00:00Z"), method: "TagMango", note: null, gateway: "TagMango", gatewayRef: tm.id, feeAmount: tm.feeAmount, feeGstAmount: tm.feeGstAmount },
  { brand: "GRATEFUL", customerName: "John Doe", invoiceNumber: "IWC-INV-001050", gstPercent: 18 }
);
assert.equal(tmRow.amountExCharges, 4499.1, "₹4,999 less TagMango's ₹499.90");
assert.equal(tmRow.amountExGst, 3736.54, "₹4,999 − ₹762.56 GST − ₹499.90 TagMango (GST backed out at 18%: 4,236.44 − 499.90)");
assert.equal(PAYMENT_METHODS.includes("TagMango"), true, "TagMango can be picked as the platform");

// --- DO price read by OCR from a photographed table ---
assert.equal(parseDeliveryOrderText("A Product Price [117,999.00 117,999.00").productPrice, 117999, "OCR bracket before the price");
assert.equal(parseDeliveryOrderText("Product Price | 1,77,000").productPrice, 177000, "OCR table bar before the price");
assert.equal(parseDeliveryOrderText("Product Price: Rs. 354000").productPrice, 354000, "label, colon and Rs.");

// --- Bajaj DO: the full amount table, when the DO has one ---
// Written to the usual Bajaj labels; only "A Product Price" is confirmed on a real DO.
const fullDo = parseDeliveryOrderText(
  "Bajaj Finance Limited DELIVERY ORDER DO ID: B429427477 Date: 18/09/2026 The loan application of Mr/Miss/Mrs. Rohan Mehta has been approved " +
    "Address of the customer for delivery: 12 MG Road, Delhi Mobile Number: 9876543210 A Product Price 117,999.00 117,999.00 " +
    "B Down Payment 17,999.00 C Loan Amount 1,00,000.00 EMI Amount Rs. 8,333 Tenure 12 Months"
);
assert.equal(fullDo.productPrice, 117999);
assert.equal(fullDo.downPayment, 17999, "down payment");
assert.equal(fullDo.loanAmount, 100000, "loan amount (Indian commas)");
assert.equal(fullDo.emi, 8333, "EMI");
assert.equal(fullDo.tenureMonths, 12, "tenure");
assert.equal(fullDo.mobile, "9876543210");
assert.equal(fullDo.customerName, "Rohan Mehta");
assert.equal(fullDo.doDate, "2026-09-18");
// A photographed DO read by OCR: table borders, ₹/Rs, a misread "EMl", spaced phone number.
const ocrDo = parseDeliveryOrderText(
  "DO ID : B429427477 | A | Product Price | ₹ 1,17,999 | B [ Down Payment ] 0 | C Loan Amount: Rs 1,17,999 | EMl Amount 9,834 | Tenure (months) 12 | Mobile No. +91 98765 43210"
);
assert.equal(ocrDo.productPrice, 117999, "OCR price");
assert.equal(ocrDo.downPayment, 0, "OCR zero down payment");
assert.equal(ocrDo.loanAmount, 117999, "OCR loan");
assert.equal(ocrDo.emi, 9834, "OCR EMI with misread I");
assert.equal(ocrDo.tenureMonths, 12, "OCR tenure");
assert.equal(ocrDo.mobile, "9876543210", "OCR mobile with spaces");
// The one-line DO seen so far: everything beyond the price stays unknown, never guessed.
const minimalDo = parseDeliveryOrderText(doText);
assert.equal(minimalDo.downPayment, null);
assert.equal(minimalDo.loanAmount, null);
assert.equal(minimalDo.emi, null);
assert.equal(minimalDo.tenureMonths, null);
assert.equal(minimalDo.mobile, null);

// --- Bajaj disbursement in the sheet: "incl. charges" is the financed amount,
// "excluding" is what reached the bank with GST taken back out ---
const bajajRow = paymentReceiptRow(
  { id: "p9", amount: 100000, paidOn: new Date("2026-09-25T00:00:00Z"), method: "Bajaj Finance disbursement", note: null, gateway: "Bajaj Finance", gatewayRef: "UTR998877", feeAmount: 8897, feeGstAmount: 0 },
  { brand: "GRATEFUL", customerName: "Kavya Sharma", invoiceNumber: "IPC-INV-002250", doId: "B429427477", gstPercent: 18 }
);
assert.equal(bajajRow.amount, 100000, "financed amount settled");
assert.equal(bajajRow.amountExCharges, 91103, "what reached the bank after Bajaj's cut");
assert.equal(bajajRow.amountExGst, Math.round((91103 / 1.18) * 100) / 100, "credited, excluding GST");
assert.equal(bajajRow.remarks, "Bajaj Finance · DO B429427477 · Bajaj kept ₹8,897 · UTR UTR998877 · IPC-INV-002250");

// --- A real Bajaj DO's layout (customer details made up) ---
const realDo = parseDeliveryOrderText(
  "Bajaj Finance Limited DELIVERY ORDER Dear GRATEFUL WORLD VENTURES OPC PRIVATE LIMITED#DELHI#BPES LSF#162312 Customer ID: A100000001 " +
    "ATOS Deal ID: Date: 03/10/2026 12:37:35 PM We are pleased to inform you that the loan application of Mr/Miss/Mrs. Test Customer has been " +
    "approved by Bajaj Finance. Disbursement Details are as follows: DO ID: B442379411 Total Roll No. / Reg. No. 0 Invoice to be made on or before " +
    "02-04-2027 Asset Category LSF PROFESSIONAL COURSES Scheme Code (GT/AE) 5002445 (12/2) A Product Price 118,000.00 118,000.00 B Gross Loan Amount " +
    "118,000.00 118,000.00 C Net Loan Amount 98334 98334 D Margin Money 0 0 E Advance EMI 19666 19666 F Service Charge 0 0 G Upfront Interest 767 767 " +
    "H Dealer Interest Subsidy value (%) 11501 (9.7468%) 11501 I MBD from Dealer Value (%) 0 0 J Card Charges (EMI, Add on Card) 530 530 CS Credit " +
    "Suraksha Fees 0 0 P Total EMI 10039 10039 U Total GST 1755 1755 V Mandate Registration Charges 0 0 W Convenience Fee Charges 320 320 " +
    "Y DP from Customer 21283 21283 YY DP from Customer through BFL RBL Supercard 0 0 Z Total Deductions 32784 32784 AA Net Disbursement 85216 85216 " +
    "Margin Money(D)= A-B Down Payment (Y)= D+E+F+G+J+AC+AD+K+M+N+V+W+AAB+CS-X-T-YY Total Deductions(Z) = D+E+F+G+H+I+J Net Disbursement(AA) = " +
    "A+X+YY-Z-TDS 194-O–BFSD-CS - BB + BC The required formalities Address of the customer for delivery: 1 Test Road, Jaipur, Rajasthan Mobile Number: 9000000001"
);
assert.equal(realDo.productPrice, 118000);
assert.equal(realDo.grossLoanAmount, 118000, "gross loan read, but not used as the loan");
assert.equal(realDo.loanAmount, 98334, "the loan is the net loan, not the gross");
assert.equal(realDo.netLoanAmount, 98334);
assert.equal(realDo.downPayment, 21283, "'DP from Customer', not the 'Margin Money 0' printed before it");
assert.equal(realDo.netDisbursement, 85216, "the row, not the formula under the table");
assert.equal(realDo.totalDeductions, 32784);
assert.equal(realDo.advanceEmi, 19666);
assert.equal(realDo.advanceEmis, 2, "from the scheme code (12/2)");
assert.equal(realDo.tenureMonths, 12, "from the scheme code (12/2)");
assert.equal(realDo.emi, 10039, "Total EMI, not the advance EMI");
assert.equal(realDo.dealerSubsidy, 11501);
assert.equal(realDo.dealerSubsidyPercent, 9.7468);
assert.equal(realDo.bajajCharges, 1617, "upfront interest + card + convenience");
assert.equal(realDo.totalGst, 1755);
assert.equal(realDo.doId, "B442379411");
assert.equal(realDo.doDate, "2026-10-03");
const details = pickDoDetails(realDo);
assert.equal(chargesCollected(details, 118000 - 98334), 1617, "the customer's down payment beyond the invoice is Bajaj's charges");
assert.equal(expectedBajajDeduction(details), 13118, "net loan − net disbursement = subsidy + charges");
assert.equal(details.dealerSubsidy + details.bajajCharges, 13118, "and the DO's own figures agree");
assert.equal(pickDoDetails({ productPrice: 5000 }), null, "an old DO with only a price keeps nothing extra");
// The payout as recorded: amount paid by customer = net loan, credited = net disbursement.
const payout = paymentReceiptRow(
  { id: "p10", amount: 98334, paidOn: new Date("2026-10-10T00:00:00Z"), method: "Bajaj Finance disbursement", note: null, gateway: "Bajaj Finance", gatewayRef: "B442379411", feeAmount: 11363, feeGstAmount: 1755 },
  { brand: "GRATEFUL", customerName: "Test Customer", invoiceNumber: "IPC-INV-002400", doId: "B442379411", gstPercent: 18 }
);
assert.equal(payout.amount, 98334, "sheet: Payment Received = net loan");
assert.equal(payout.amountExCharges, 85216, "sheet: Excluding charges = net disbursement");
assert.equal(payout.amountExGst, 72216.95, "sheet: Excluding GST = net disbursement less 18% inside it");
assert.equal(payout.remarks, "Bajaj Finance · DO B442379411 · Bajaj kept ₹13,118 · IPC-INV-002400", "no UTR when the ref is the DO");

// --- B2C inter-state: no GSTIN, so the place of supply decides ---
assert.equal(stateCodeFromPlaceOfSupply("Uttar Pradesh (09)"), "09");
assert.equal(stateCodeFromPlaceOfSupply("Haryana"), "06", "bare state name");
assert.equal(stateCodeFromPlaceOfSupply(""), null);
assert.equal(isInterStateSupply(null, "Uttar Pradesh (09)"), true, "Noida customer without GSTIN pays IGST");
assert.equal(isInterStateSupply(null, "Delhi (07)"), false, "Delhi B2C stays CGST+SGST");
assert.equal(isInterStateSupply("07AAJCG9243K1Z5", "Maharashtra (27)"), false, "a GSTIN outranks the place of supply");
assert.equal(isInterStateSupply(null, null), false, "nothing known: intra-state");
assert.equal(guessStateCodeFromAddress("Flat 12, Sector 62, Noida 201301"), "09", "Noida is UP");
assert.equal(guessStateCodeFromAddress("DLF Phase 3, Gurugram"), "06", "Gurugram is Haryana");
assert.equal(guessStateCodeFromAddress("B-4 Laxmi Nagar, New Delhi 110092"), "07");
assert.equal(guessStateCodeFromAddress("12 MG Road, Bengaluru, Karnataka 560001"), "29", "state name wins");
assert.equal(guessStateCodeFromAddress("Salt Lake, West Bengal"), "19");
assert.equal(guessStateCodeFromAddress("Somewhere unknown"), null);

// --- Financial-year numbering ---
assert.equal(fyLabel(new Date("2026-04-01T00:00:00Z")), "26-27", "April starts the FY");
assert.equal(fyLabel(new Date("2027-03-31T00:00:00Z")), "26-27", "March ends it");
assert.equal(fyLabel(new Date("2027-04-01T00:00:00Z")), "27-28");
assert.equal(resolvePrefix("IPC/{FY}/", new Date("2026-09-23T00:00:00Z")), "IPC/26-27/");
assert.equal(formatInvoiceNumber("IPC/26-27/", 12, 4), "IPC/26-27/0012");
assert.equal(previewInvoiceNumber({ invoicePrefix: "IPC/{FY}/", invoiceNextNumber: 999, invoiceDigits: 4 }, { date: new Date("2027-04-02T00:00:00Z"), fyNext: 1 }), "IPC/27-28/0001", "a new FY restarts at 1");
assert.equal(previewInvoiceNumber({ invoicePrefix: "IPC-INV-", invoiceNextNumber: 2250 }), "IPC-INV-002250", "no {FY}: one running series");
assert.equal(longestNumberFor("IPC/{FY}/", 6), 16, "fits GST's 16 characters exactly");

// --- Multi-line invoices: tax per line at its own rate, then summed ---
const multi = computeInvoice(
  [
    { description: "Course", hsnSac: "999293", qty: 1, grossAmount: 117999, gstPercent: 18 },
    { description: "Books", hsnSac: "4901", qty: 2, grossAmount: 1050, gstPercent: 5 },
  ],
  { isInterState: false }
);
assert.equal(multi.total, 119049, "total is the sum of the lines");
assert.equal(Math.round((multi.subTotal + multi.cgst + multi.sgst + multi.igst + multi.adjustment) * 100) / 100, 119049, "parts reconcile");
assert.equal(multi.hsnSummary.length, 2, "one HSN row per code and rate");
assert.equal(multi.hsnSummary.find((h) => h.hsnSac === "4901").taxable, 1000, "books taxable at 5%");
assert.equal(computeInvoice([{ description: "x", hsnSac: "1", qty: 1, grossAmount: 11800, gstPercent: 18 }], { isInterState: true }).igst, 1800, "IGST per line");
assert.equal(computeInvoice([{ description: "x", hsnSac: "1", qty: 1, grossAmount: 170000, gstPercent: 18 }], { isInterState: false, gstRegistered: false }).cgst, 0, "unregistered sellers charge no tax");
assert.equal(invoiceSummaryFields([{ description: "Course", hsnSac: "999293", qty: 1, grossAmount: 100, gstPercent: 18 }, { description: "Books", hsnSac: "4901", qty: 2, grossAmount: 50, gstPercent: 5 }]).itemDescription, "Course + 1 more");

// --- Balance: credit notes, refunds, TDS, cancellation ---
let bal = invoiceBalance({ grossAmount: 118000, status: "ISSUED", creditNotes: [], payments: [{ amount: 106200 }, { amount: 11800, tdsAmount: 11800 }] });
assert.ok(bal.settled && bal.tds === 11800, "TDS withheld by the customer settles the invoice");
bal = invoiceBalance({ grossAmount: 118000, status: "ISSUED", creditNotes: [{ grossAmount: 18000 }], payments: [{ amount: 118000 }] });
assert.equal(bal.net, 100000, "credit note reduces what's owed");
assert.equal(bal.toRefund, 18000, "overpaid after a credit note: to refund");
bal = invoiceBalance({ grossAmount: 118000, status: "ISSUED", creditNotes: [{ grossAmount: 18000 }], payments: [{ amount: 118000 }, { amount: 18000, kind: "REFUND" }] });
assert.ok(bal.settled && bal.toRefund === 0, "refund closes it");
bal = invoiceBalance({ grossAmount: 118000, status: "CANCELLED", creditNotes: [], payments: [] });
assert.ok(bal.cancelled && bal.net === 0 && bal.balance === 0, "a cancelled invoice owes nothing");

// --- Sheet rows for TDS, refunds and multi-rate invoices ---
{
  const inv = { brand: "GRATEFUL", customerName: "Acme", invoiceNumber: "IPC-INV-002300", gstPercent: 18 };
  const tdsRow = paymentReceiptRow(
    { id: "t1", amount: 118000, paidOn: new Date("2026-09-20T00:00:00Z"), method: "Bank transfer", note: null, gateway: null, feeAmount: 0, feeGstAmount: 0, tdsAmount: 10000, tdsSection: "194J" },
    inv
  );
  assert.equal(tdsRow.amount, 118000, "TDS is still part of what the customer settled");
  assert.equal(tdsRow.amountExGst, 100000, "TDS isn't a charge: excluding GST is the full taxable value");
  assert.match(tdsRow.remarks, /TDS 194J ₹10,000/);
  const refundRow = paymentReceiptRow(
    { id: "r1", amount: 11800, paidOn: new Date("2026-09-21T00:00:00Z"), method: "UPI", note: null, gateway: null, feeAmount: 0, feeGstAmount: 0, kind: "REFUND" },
    inv
  );
  assert.equal(refundRow.amount, -11800, "a refund is a negative receipt");
  assert.equal(refundRow.amountExGst, -10000);
  assert.match(refundRow.remarks, /^Refund · UPI/);
  const mixed = paymentReceiptRow(
    { id: "m1", amount: 119049, paidOn: new Date("2026-09-21T00:00:00Z"), method: "UPI", note: null, gateway: null, feeAmount: 0, feeGstAmount: 0 },
    { ...inv, taxableRatio: 100999.15 / 119049 }
  );
  assert.equal(mixed.amountExGst, 100999.15, "several GST rates: the invoice's own taxable share is used");
}

// --- GST report: multi-line invoices, credit notes (CDNR/CDNUR), HSN summary ---
const multiLine = gstLine({
  id: "m", invoiceNumber: "M", invoiceDate: new Date("2026-09-10T00:00:00Z"), customerName: "Acme", customerGstin: "07AAJCG9243K1Z5",
  placeOfSupply: "Delhi (07)", grossAmount: 119049, gstPercent: 18, qty: 3, business: "IPC Finance",
  lines: [
    { description: "Course", hsnSac: "999293", qty: 1, grossAmount: 117999, gstPercent: 18 },
    { description: "Books", hsnSac: "4901", qty: 2, grossAmount: 1050, gstPercent: 5 },
  ],
});
assert.equal(multiLine.value, 119049, "report value is the lines' total");
assert.equal(multiLine.hsn.length, 2, "one HSN row per code and rate");
assert.equal(Math.round((multiLine.taxable + multiLine.tax + multiLine.adjustment) * 100) / 100, 119049, "multi-line reconciles");
const cnB2B = gstCreditLine({
  id: "cn1", number: "CN/26-27/000001", noteDate: new Date("2026-10-05T00:00:00Z"), reason: "Price correction",
  grossAmount: 11800, gstPercent: 18, invoiceNumber: "M", invoiceDate: new Date("2026-09-10T00:00:00Z"),
  customerName: "Acme", customerGstin: "07AAJCG9243K1Z5", placeOfSupply: "Delhi (07)", business: "IPC Finance", hsnSac: "999293",
});
assert.ok(cnB2B.b2b && cnB2B.cgst === 900 && cnB2B.sgst === 900 && cnB2B.taxable === 10000, "CDNR: same split as the Delhi invoice");
assert.equal(cnB2B.month, "2026-10", "reported in the credit note's month, not the invoice's");
const cnB2C = gstCreditLine({ ...cnB2B, id: "cn2", customerGstin: null, placeOfSupply: "Uttar Pradesh (09)" });
assert.ok(!cnB2C.b2b && cnB2C.igst === 1800, "CDNUR to an out-of-state consumer is IGST");
const netOut = netOfCredits(sumLines([multiLine]), sumLines([cnB2B]));
assert.equal(netOut.tax, Math.round((multiLine.tax - 1800) * 100) / 100, "credit note tax comes off output tax");
const hsnRows = hsnSummary([multiLine], [cnB2B]);
assert.equal(hsnRows.find((h) => h.hsnSac === "999293").taxable, Math.round((multiLine.hsn.find((h) => h.hsnSac === "999293").taxable - 10000) * 100) / 100, "HSN net of credit note");
const months2 = monthlySummary([multiLine], [cnB2B]);
assert.deepEqual(months2.map((x) => x.month), ["2026-09", "2026-10"], "a month with only a credit note still appears");
assert.equal(months2[1].net.tax, -1800, "October: only the credit, negative net output");

console.log("All invoice money-path checks passed.");
