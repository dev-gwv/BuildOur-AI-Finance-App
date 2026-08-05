export interface ParsedGstCertificate {
  gstin: string | null;
  legalName: string | null;
  tradeName: string | null;
  address: string | null;
}

// 2-digit state code, 10-char PAN, entity number, 'Z', checksum.
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const value = re.exec(text)?.[1]?.trim();
    // Guard against a label bleeding through when the field itself is blank.
    if (value && value.length > 1) return value.replace(/\s+/g, " ");
  }
  return null;
}

/** True when the text looks like a GST registration certificate rather than a Bajaj DO. */
export function looksLikeGstCertificate(text: string): boolean {
  return /GST\s*REG-?\s*06|Registration Certificate/i.test(text) || GSTIN_RE.test(text);
}

/**
 * Pulls customer details out of a GST registration certificate (Form GST REG-06).
 * Field labels vary between state portals and download vintages, so each field
 * tries several wordings; anything not found comes back null for the user to
 * fill in by hand rather than guessing.
 */
export function parseGstCertificateText(text: string): ParsedGstCertificate {
  return {
    gstin: GSTIN_RE.exec(text)?.[0] ?? null,
    legalName: firstMatch(text, [
      /Legal Name(?:\s*of\s*Business)?\s*[:\-]?\s*(.+?)\s*(?:\d+\.|Trade Name|Constitution|Address|Additional)/i,
    ]),
    tradeName: firstMatch(text, [
      /Trade Name(?:\s*,?\s*if any)?\s*[:\-]?\s*(.+?)\s*(?:\d+\.|Constitution|Address|Additional|Legal Name)/i,
    ]),
    address: firstMatch(text, [
      /Address of Principal Place of Business\s*[:\-]?\s*(.+?)\s*(?:\d+\.|Date of Liability|Date of Validity|Period of Validity|Constitution|Type of Registration)/i,
      /Principal Place of Business\s*[:\-]?\s*(.+?)\s*(?:\d+\.|Date of|Period of|Constitution|Type of Registration)/i,
    ]),
  };
}
