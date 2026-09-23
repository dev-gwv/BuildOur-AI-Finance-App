// GST state codes (2 digits) as per GSTIN first 2 characters.
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh (New)",
  "38": "Ladakh",
};

export const HOME_STATE_CODE = "07"; // Delhi - Grateful World Ventures

export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const trimmed = gstin.trim().toUpperCase();
  const match = /^\d{2}/.exec(trimmed);
  if (!match) return null;
  return match[0];
}

export function stateNameFromCode(code: string | null): string | null {
  if (!code) return null;
  return GST_STATE_CODES[code] ?? null;
}

export function placeOfSupplyFromGstin(gstin: string | null | undefined): string | null {
  const code = stateCodeFromGstin(gstin);
  if (!code) return null;
  const name = stateNameFromCode(code);
  if (!name) return null;
  return `${name} (${code})`;
}

/** "Maharashtra (27)" -> "27"; also a bare state name ("Uttar Pradesh"). */
export function stateCodeFromPlaceOfSupply(placeOfSupply: string | null | undefined): string | null {
  if (!placeOfSupply) return null;
  const code = /\((\d{2})\)/.exec(placeOfSupply)?.[1];
  if (code && GST_STATE_CODES[code]) return code;
  const name = placeOfSupply.trim().toLowerCase();
  const hit = Object.entries(GST_STATE_CODES).find(([, n]) => n.toLowerCase() === name);
  return hit?.[0] ?? null;
}

// Cities outside Delhi that customers of a Delhi business commonly write
// without naming the state — the NCR is where an address most often looks
// local but isn't.
const CITY_STATES: Array<[RegExp, string]> = [
  [/\b(greater\s+)?noida\b|\bghaziabad\b|\blucknow\b|\bkanpur\b|\bagra\b|\bmeerut\b|\bvaranasi\b/i, "09"],
  [/\bgurugram\b|\bgurgaon\b|\bfaridabad\b|\bsonipat\b|\bpanipat\b|\bkarnal\b|\bambala\b/i, "06"],
  [/\bmumbai\b|\bpune\b|\bthane\b|\bnagpur\b|\bnavi mumbai\b/i, "27"],
  [/\bbengaluru\b|\bbangalore\b|\bmysuru\b/i, "29"],
  [/\bhyderabad\b/i, "36"],
  [/\bchennai\b/i, "33"],
  [/\bkolkata\b/i, "19"],
  [/\bjaipur\b/i, "08"],
  [/\bchandigarh\b/i, "04"],
  [/\bnew delhi\b|\bdelhi\b/i, "07"],
];

/**
 * Best guess of the state an address is in: a state name, else a well-known
 * city. Used to suggest the place of supply for a customer without a GSTIN;
 * the user can always change it. Null when nothing is recognisable.
 */
export function guessStateCodeFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  // Longest names first, so "Andhra Pradesh (New)" / "West Bengal" win over shorter overlaps.
  const states = Object.entries(GST_STATE_CODES).sort((a, b) => b[1].length - a[1].length);
  for (const [code, name] of states) {
    const plain = name.replace(/\s*\(New\)$/, "");
    const pattern = new RegExp(`\\b${plain.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(address)) return code;
  }
  return CITY_STATES.find(([re]) => re.test(address))?.[1] ?? null;
}

export function placeOfSupplyFromCode(code: string | null): string | null {
  const name = stateNameFromCode(code);
  return name && code ? `${name} (${code})` : null;
}

/**
 * Whether a sale crosses state lines (IGST) or not (CGST + SGST). The
 * customer's GSTIN decides when there is one; otherwise the place of supply
 * does — a customer in Noida without a GSTIN is still inter-state. With
 * neither, it's treated as intra-state.
 */
export function isInterStateSupply(
  customerGstin: string | null | undefined,
  placeOfSupply?: string | null,
  homeCode: string = HOME_STATE_CODE
): boolean {
  const code = stateCodeFromGstin(customerGstin) ?? stateCodeFromPlaceOfSupply(placeOfSupply);
  if (!code) return false;
  return code !== homeCode;
}
