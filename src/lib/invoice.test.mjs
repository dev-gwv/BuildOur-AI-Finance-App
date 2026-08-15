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

console.log("All invoice money-path checks passed.");
