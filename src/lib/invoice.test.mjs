// Money-path self-check. Run: node src/lib/invoice.test.mjs
// Expected values are taken from the real reference invoice INV-002241,
// so a regression here means we'd bill a customer differently than before.
import assert from "node:assert/strict";
import { calculateInvoiceBreakup } from "./invoiceCalc.ts";
import { amountInWords, numberToIndianWords } from "./numberToWords.ts";

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

console.log("All invoice money-path checks passed.");
