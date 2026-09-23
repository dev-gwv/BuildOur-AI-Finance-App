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

export function isInterStateSupply(customerGstin: string | null | undefined, homeCode: string = HOME_STATE_CODE): boolean {
  const code = stateCodeFromGstin(customerGstin);
  if (!code) return false; // No GSTIN / B2C -> treat as intra-state (CGST+SGST)
  return code !== homeCode;
}
