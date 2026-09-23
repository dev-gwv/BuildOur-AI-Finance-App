import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { BRANDS, type BrandKey } from "@/lib/brands";
import { computeInvoice, invoiceBalance, type LineInput } from "@/lib/invoiceLines";
import { isInterStateSupply } from "@/lib/gstState";
import { amountInWords } from "@/lib/numberToWords";
import { formatCurrency, formatDate } from "@/lib/format";
import { GEIST_REGULAR_TTF } from "./geistFont";

// The invoice as a real PDF — what's attached to emails and downloaded — laid
// out like the on-screen tax invoice. Geist carries the rupee sign; the
// built-in Helvetica-Bold (no ₹) is used only for words, never amounts.
Font.register({ family: "Geist", src: GEIST_REGULAR_TTF });
// Long words (addresses, item names) shouldn't be split with hyphens.
Font.registerHyphenationCallback((word) => [word]);

export interface InvoicePdfData {
  brand: BrandKey;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  status: string;
  cancelReason: string | null;
  customerName: string;
  customerAddress: string;
  customerGstin: string | null;
  placeOfSupply: string;
  notes: string | null;
  terms: string | null;
  doId: string | null;
  saleType: string;
  downPayment: number | null;
  financedAmount: number | null;
  revisedAt: Date | null;
  lines: LineInput[];
  creditNotes: { number: string; noteDate: Date; grossAmount: number }[];
  payments: { amount: number; kind: string; tdsAmount: number; method: string | null }[];
  signatureDataUri: string;
}

/** Header colours per brand, matching the on-screen document. */
const HEADER: Record<BrandKey, { bg: string; accent: string }> = {
  GRATEFUL: { bg: "#4338ca", accent: "#c7d2fe" },
  MULBERRY: { bg: "#5b0d1c", accent: "#fde68a" },
};

const INK = "#171717";
const MUTED = "#525252";
const FAINT = "#737373";
const LINE = "#e5e5e5";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9, color: INK, paddingBottom: 36 },
  header: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 32, paddingVertical: 24, color: "#ffffff" },
  headerLeft: { flexDirection: "row", flexGrow: 1, flexShrink: 1, gap: 12 },
  logo: { width: 52, height: 52, borderRadius: 6 },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 1.5 },
  sellerName: { fontFamily: "Helvetica-Bold", fontSize: 15, marginTop: 3, marginBottom: 3 },
  headerText: { fontSize: 9, color: "#e5e7eb", marginTop: 1 },
  headerRight: { alignItems: "flex-end", marginLeft: 16 },
  pill: { fontSize: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.18)" },
  number: { fontSize: 17, marginTop: 8 },

  section: { paddingHorizontal: 32 },
  parties: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 32, paddingTop: 20, paddingBottom: 14 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7, color: FAINT, letterSpacing: 1, marginBottom: 4 },
  billName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 3 },
  body: { fontSize: 9, color: MUTED, lineHeight: 1.4 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 3 },
  metaKey: { width: 92, color: FAINT, textAlign: "right", marginRight: 10 },
  metaVal: { width: 110, textAlign: "right" },

  table: { borderTopWidth: 1, borderTopColor: LINE },
  thead: { flexDirection: "row", backgroundColor: "#fafafa", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 6 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7, color: FAINT, letterSpacing: 0.5 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f5f5f5", paddingVertical: 7 },
  num: { textAlign: "right" },
  small: { fontSize: 7, color: FAINT },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 32, paddingTop: 12 },
  totals: { width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, color: MUTED },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, marginTop: 2, marginBottom: 6, fontSize: 11, color: INK },
  box: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 6, marginBottom: 6 },
  due: { flexDirection: "row", justifyContent: "space-between", borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11 },

  words: { marginHorizontal: 32, marginTop: 10, backgroundColor: "#fafafa", borderRadius: 4, padding: 8, color: MUTED },
  twoCol: { flexDirection: "row", gap: 24, paddingHorizontal: 32, paddingTop: 12 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTopWidth: 1, borderTopColor: LINE, marginTop: 16, marginHorizontal: 32, paddingTop: 12 },
  sign: { height: 40, objectFit: "contain", marginLeft: "auto", marginBottom: 2 },
  signLine: { width: 170, borderBottomWidth: 1, borderBottomColor: "#d4d4d4", marginLeft: "auto" },
  fine: { position: "absolute", bottom: 14, left: 32, right: 32, textAlign: "center", fontSize: 7, color: "#a3a3a3" },
  stamp: {
    position: "absolute",
    top: 330,
    left: 90,
    fontFamily: "Helvetica-Bold",
    fontSize: 64,
    color: "#dc2626",
    opacity: 0.18,
    transform: "rotate(-24deg)",
    letterSpacing: 6,
  },
});

const money = (n: number) => formatCurrency(n);
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const brand = BRANDS[data.brand];
  const colors = HEADER[data.brand];
  const registered = brand.gstRegistered;
  const isInterState = registered ? isInterStateSupply(data.customerGstin, data.placeOfSupply) : false;
  const totals = computeInvoice(data.lines, { isInterState, gstRegistered: registered });
  const igst = totals.taxMode === "IGST";
  const bal = invoiceBalance({ grossAmount: totals.total, status: data.status, creditNotes: data.creditNotes, payments: data.payments });
  const cancelled = data.status === "CANCELLED";
  const isBajaj = data.saleType === "BAJAJ";
  const financed = isBajaj ? (data.financedAmount ?? totals.total - (data.downPayment ?? 0)) : 0;
  const bajajPending = isBajaj && !data.payments.some((p) => p.method === "Bajaj Finance disbursement");
  // One rate across every line: the totals can name it; mixed rates can't.
  const rates = [...new Set(totals.lines.map((l) => l.gstPercent))];
  const singleRate = rates.length === 1 ? rates[0] : null;

  // Column widths (points) for the lines table; the description takes the rest.
  const cols = registered
    ? igst
      ? { idx: 18, hsn: 52, qty: 34, rate: 70, tax: 80, amt: 80 }
      : { idx: 18, hsn: 52, qty: 34, rate: 66, tax: 64, amt: 76 }
    : { idx: 18, hsn: 0, qty: 40, rate: 90, tax: 0, amt: 96 };

  return (
    <Document title={`${brand.documentTitle} ${data.invoiceNumber}`} author={brand.name} subject={`${brand.documentTitle} for ${data.customerName}`}>
      <Page size="A4" style={s.page}>
        {/* Seller */}
        <View style={[s.header, { backgroundColor: colors.bg }]}>
          <View style={s.headerLeft}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {brand.logoDataUri && <Image src={brand.logoDataUri} style={s.logo} />}
            <View style={{ flexShrink: 1 }}>
              <Text style={[s.eyebrow, { color: colors.accent }]}>
                {brand.documentTitle.toUpperCase()}
                {data.revisedAt ? `   ·   REVISED ${formatDate(data.revisedAt).toUpperCase()}` : ""}
              </Text>
              <Text style={s.sellerName}>{brand.name}</Text>
              {brand.addressLines.map((line) => (
                <Text key={line} style={s.headerText}>
                  {line}
                </Text>
              ))}
              {registered && (
                <Text style={s.headerText}>
                  GSTIN {brand.gstin} · CIN {brand.companyId}
                </Text>
              )}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.pill}>
              {cancelled ? "Cancelled" : bal.settled ? "Paid in full" : `Balance due ${money(bal.balance)}`}
            </Text>
            <Text style={s.number}>#{data.invoiceNumber}</Text>
          </View>
        </View>

        {/* Customer + invoice facts */}
        <View style={s.parties}>
          <View style={{ width: 250 }}>
            <Text style={s.label}>BILL TO</Text>
            <Text style={s.billName}>{data.customerName}</Text>
            {data.customerAddress ? <Text style={s.body}>{data.customerAddress}</Text> : null}
            <Text style={s.body}>India</Text>
            {data.customerGstin && <Text style={[s.body, { color: INK, marginTop: 2 }]}>GSTIN {data.customerGstin}</Text>}
          </View>
          <View>
            <Meta k="Invoice date" v={formatDate(data.invoiceDate)} />
            <Meta k="Due date" v={formatDate(data.dueDate)} />
            {registered && <Meta k="Place of supply" v={data.placeOfSupply} />}
            {data.doId && <Meta k={isBajaj ? "Bajaj Finance DO" : "DO reference"} v={data.doId} />}
          </View>
        </View>

        {/* Lines */}
        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead}>
              <Text style={[s.th, { width: cols.idx }]}>#</Text>
              <Text style={[s.th, { flex: 1 }]}>ITEM &amp; DESCRIPTION</Text>
              {registered && <Text style={[s.th, { width: cols.hsn }]}>HSN/SAC</Text>}
              <Text style={[s.th, s.num, { width: cols.qty }]}>QTY</Text>
              <Text style={[s.th, s.num, { width: cols.rate }]}>RATE</Text>
              {registered && igst && <Text style={[s.th, s.num, { width: cols.tax }]}>IGST</Text>}
              {registered && !igst && (
                <>
                  <Text style={[s.th, s.num, { width: cols.tax }]}>CGST</Text>
                  <Text style={[s.th, s.num, { width: cols.tax }]}>SGST</Text>
                </>
              )}
              <Text style={[s.th, s.num, { width: cols.amt }]}>AMOUNT</Text>
            </View>
            {totals.lines.map((l, i) => (
              <View key={i} style={s.tr} wrap={false}>
                <Text style={{ width: cols.idx, color: FAINT }}>{i + 1}</Text>
                <Text style={{ flex: 1, paddingRight: 6 }}>{l.description}</Text>
                {registered && <Text style={{ width: cols.hsn, color: MUTED }}>{l.hsnSac}</Text>}
                <Text style={[s.num, { width: cols.qty, color: MUTED }]}>{(l.qty || 1).toFixed(2)}</Text>
                <Text style={[s.num, { width: cols.rate, color: MUTED }]}>{money(l.breakup.rate)}</Text>
                {registered && igst && (
                  <View style={{ width: cols.tax }}>
                    <Text style={[s.num, { color: MUTED }]}>{money(l.breakup.igstAmount)}</Text>
                    <Text style={[s.num, s.small]}>{pct(l.breakup.igstPercent)}</Text>
                  </View>
                )}
                {registered && !igst && (
                  <>
                    <View style={{ width: cols.tax }}>
                      <Text style={[s.num, { color: MUTED }]}>{money(l.breakup.cgstAmount)}</Text>
                      <Text style={[s.num, s.small]}>{pct(l.breakup.cgstPercent)}</Text>
                    </View>
                    <View style={{ width: cols.tax }}>
                      <Text style={[s.num, { color: MUTED }]}>{money(l.breakup.sgstAmount)}</Text>
                      <Text style={[s.num, s.small]}>{pct(l.breakup.sgstPercent)}</Text>
                    </View>
                  </>
                )}
                <Text style={[s.num, { width: cols.amt }]}>{money(l.breakup.subTotal)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Totals */}
        <View style={s.totalsWrap} wrap={false}>
          <View style={s.totals}>
            <Row k="Sub total" v={money(totals.subTotal)} />
            {registered && igst && <Row k={`IGST${singleRate !== null ? ` (${pct(singleRate)})` : ""}`} v={money(totals.igst)} />}
            {registered && !igst && (
              <>
                <Row k={`CGST${singleRate !== null ? ` (${pct(singleRate / 2)})` : ""}`} v={money(totals.cgst)} />
                <Row k={`SGST${singleRate !== null ? ` (${pct(singleRate / 2)})` : ""}`} v={money(totals.sgst)} />
              </>
            )}
            {registered && totals.adjustment !== 0 && <Row k="Rounding" v={money(totals.adjustment)} />}
            <View style={s.grand}>
              <Text>Total</Text>
              <Text>{money(totals.total)}</Text>
            </View>

            {isBajaj && (
              <View style={s.box}>
                <Text style={[s.label, { marginBottom: 3 }]}>
                  FINANCED BY BAJAJ FINANCE{data.doId ? ` · DO ${data.doId}` : ""}
                </Text>
                {(data.downPayment ?? 0) > 0 && <Row k="Down payment by customer" v={money(data.downPayment ?? 0)} />}
                <Row k="Financed by Bajaj Finance" v={money(financed)} />
              </View>
            )}

            {data.creditNotes.map((c) => (
              <Row key={c.number} k={`Credit note ${c.number}`} v={`(-) ${money(c.grossAmount)}`} />
            ))}
            {bal.received > 0 && <Row k={bal.tds > 0 ? "Paid (incl. TDS)" : "Payment made"} v={`(-) ${money(bal.received)}`} />}
            {bal.tds > 0 && <Row k="   of which TDS deducted" v={money(bal.tds)} />}
            {bal.refunded > 0 && <Row k="Refunded" v={`(+) ${money(bal.refunded)}`} />}

            {cancelled ? (
              <View style={[s.due, { backgroundColor: "#fef2f2", color: "#b91c1c" }]}>
                <Text>Cancelled</Text>
                <Text>{money(0)}</Text>
              </View>
            ) : bal.toRefund > 0 ? (
              <View style={[s.due, { backgroundColor: "#fffbeb", color: "#b45309" }]}>
                <Text>To be refunded</Text>
                <Text>{money(bal.toRefund)}</Text>
              </View>
            ) : (
              <View style={[s.due, bal.settled ? { backgroundColor: "#ecfdf5", color: "#047857" } : { backgroundColor: "#f5f5f5" }]}>
                <Text>{bajajPending && !bal.settled ? "Balance due (Bajaj Finance)" : "Balance due"}</Text>
                <Text>{money(bal.balance)}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.words} wrap={false}>
          <Text>
            Total in words: <Text style={{ color: INK }}>{amountInWords(totals.total)}</Text>
          </Text>
        </View>

        {cancelled && data.cancelReason && (
          <View style={[s.words, { backgroundColor: "#fef2f2", color: "#b91c1c" }]} wrap={false}>
            <Text>Cancelled: {data.cancelReason}</Text>
          </View>
        )}

        {/* HSN summary — GSTR-1 Table 12 */}
        {registered && (
          <View style={[s.section, { marginTop: 14 }]} wrap={false}>
            <Text style={s.label}>HSN / SAC SUMMARY</Text>
            <View style={s.table}>
              <View style={s.thead}>
                <Text style={[s.th, { flex: 1 }]}>HSN/SAC</Text>
                <Text style={[s.th, s.num, { width: 44 }]}>RATE</Text>
                <Text style={[s.th, s.num, { width: 84 }]}>TAXABLE</Text>
                {igst ? (
                  <Text style={[s.th, s.num, { width: 84 }]}>IGST</Text>
                ) : (
                  <>
                    <Text style={[s.th, s.num, { width: 74 }]}>CGST</Text>
                    <Text style={[s.th, s.num, { width: 74 }]}>SGST</Text>
                  </>
                )}
                <Text style={[s.th, s.num, { width: 84 }]}>TOTAL TAX</Text>
              </View>
              {totals.hsnSummary.map((h) => (
                <View key={`${h.hsnSac}-${h.gstPercent}`} style={s.tr}>
                  <Text style={{ flex: 1 }}>{h.hsnSac}</Text>
                  <Text style={[s.num, { width: 44, color: MUTED }]}>{pct(h.gstPercent)}</Text>
                  <Text style={[s.num, { width: 84 }]}>{money(h.taxable)}</Text>
                  {igst ? (
                    <Text style={[s.num, { width: 84 }]}>{money(h.igst)}</Text>
                  ) : (
                    <>
                      <Text style={[s.num, { width: 74 }]}>{money(h.cgst)}</Text>
                      <Text style={[s.num, { width: 74 }]}>{money(h.sgst)}</Text>
                    </>
                  )}
                  <Text style={[s.num, { width: 84 }]}>{money(h.cgst + h.sgst + h.igst)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {(data.notes || data.terms) && (
          <View style={s.twoCol} wrap={false}>
            {data.notes && (
              <View style={{ flex: 1 }}>
                <Text style={s.label}>NOTES</Text>
                <Text style={s.body}>{data.notes}</Text>
              </View>
            )}
            {data.terms && (
              <View style={{ flex: 1 }}>
                <Text style={s.label}>TERMS &amp; CONDITIONS</Text>
                <Text style={s.body}>{data.terms}</Text>
              </View>
            )}
          </View>
        )}

        {/* Bank + signature */}
        <View style={s.footer} wrap={false}>
          <View style={s.body}>
            {brand.bank ? (
              <>
                <Text style={s.label}>BANK ACCOUNT DETAILS</Text>
                <Text>Account name: {brand.bank.accountName}</Text>
                <Text>Account number: {brand.bank.accountNumber}</Text>
                <Text>
                  IFSC: {brand.bank.ifsc} · {brand.bank.bankName} ({brand.bank.accountType})
                </Text>
              </>
            ) : (
              <Text>{brand.name}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={data.signatureDataUri} style={s.sign} />
            <View style={s.signLine} />
            <Text style={{ fontSize: 8, marginTop: 3 }}>Authorised Signatory</Text>
            <Text style={s.small}>{brand.name}</Text>
          </View>
        </View>

        {cancelled && (
          <Text style={s.stamp} fixed>
            CANCELLED
          </Text>
        )}
        <Text style={s.fine} fixed>
          This is a computer-generated {brand.documentTitle.toLowerCase()} and is valid without a physical stamp.
        </Text>
      </Page>
    </Document>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.totalRow}>
      <Text>{k}</Text>
      <Text>{v}</Text>
    </View>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaKey}>{k}</Text>
      <Text style={s.metaVal}>{v}</Text>
    </View>
  );
}
