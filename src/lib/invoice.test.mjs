// Money-path self-check. Run: node src/lib/invoice.test.mjs
// Expected values are taken from the real reference invoice INV-002241,
// so a regression here means we'd bill a customer differently than before.
import assert from "node:assert/strict";
import { calculateInvoiceBreakup } from "./invoiceCalc.ts";
import { amountInWords, numberToIndianWords } from "./numberToWords.ts";
import { looksLikeGstCertificate, parseGstCertificateText } from "./parseGstCertificate.ts";
import { parseDeliveryOrderText } from "./parseDeliveryOrder.ts";

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

console.log("All invoice money-path checks passed.");
