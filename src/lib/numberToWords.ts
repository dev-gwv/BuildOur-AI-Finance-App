const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ` ${ONES[ones]}` : "");
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return (hundreds ? `${ONES[hundreds]} Hundred${rest ? " " : ""}` : "") + (rest ? twoDigits(rest) : "");
}

/** Indian numbering system (lakh/crore) words for a non-negative integer. */
export function numberToIndianWords(value: number): string {
  const n = Math.round(Math.abs(value));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n / 1_00_000) % 100);
  const thousand = Math.floor((n / 1000) % 100);
  const hundred = n % 1000;

  return [
    crore && `${twoDigits(crore)} Crore`,
    lakh && `${twoDigits(lakh)} Lakh`,
    thousand && `${twoDigits(thousand)} Thousand`,
    hundred && threeDigits(hundred),
  ]
    .filter(Boolean)
    .join(" ");
}

export function amountInWords(value: number): string {
  return `Indian Rupee ${numberToIndianWords(value)} Only`;
}
