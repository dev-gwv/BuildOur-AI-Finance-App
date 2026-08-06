import { BRANDS, type BrandKey } from "./brands";

export interface InvoiceEmailData {
  brand: BrandKey;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: Date | string;
  dueDate: Date | string;
  itemDescription: string;
  total: number;
  amountPaid: number;
  notes?: string | null;
  terms?: string | null;
  /** Covering message written by the business; shown above the invoice summary. */
  message?: string;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function invoiceEmailSubject(data: InvoiceEmailData): string {
  const brand = BRANDS[data.brand];
  return `${brand.documentTitle} ${data.invoiceNumber} from ${brand.name}`;
}

export function invoiceEmailText(data: InvoiceEmailData): string {
  const brand = BRANDS[data.brand];
  const balance = Math.round((data.total - data.amountPaid) * 100) / 100;
  const opening = data.message?.trim()
    ? data.message.trim()
    : `Dear ${data.customerName},\n\nHere is ${brand.documentTitle.toLowerCase()} ${data.invoiceNumber} from ${brand.name}.`;
  return [
    opening,
    ``,
    `--------------------------------`,
    `Invoice number : ${data.invoiceNumber}`,
    `Invoice date   : ${day.format(new Date(data.invoiceDate))}`,
    `Amount         : ${inr.format(data.total)}`,
    data.amountPaid > 0 ? `Received       : ${inr.format(data.amountPaid)}` : null,
    `Balance due    : ${inr.format(Math.max(balance, 0))}`,
    `--------------------------------`,
    ``,
    data.notes ?? "",
    brand.bank
      ? `\nBank details: ${brand.bank.accountName}\nA/c ${brand.bank.accountNumber} · IFSC ${brand.bank.ifsc} · ${brand.bank.bankName}`
      : "",
  ]
    .filter((l) => l !== null)
    .join("\n")
    .trimEnd();
}

/**
 * Invoice email body. Built with tables and inline styles because that is what
 * mail clients reliably render — Outlook in particular ignores most modern CSS.
 */
export function invoiceEmailHtml(data: InvoiceEmailData): string {
  const brand = BRANDS[data.brand];
  const balance = Math.round((data.total - data.amountPaid) * 100) / 100;
  const settled = balance <= 0;
  const accent = data.brand === "MULBERRY" ? "#5b0d1c" : "#4338ca";

  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:8px 0;color:#525252;font-size:14px;">${esc(label)}</td>
      <td style="padding:8px 0;text-align:right;font-size:14px;color:#171717;${strong ? "font-weight:700;" : ""}">${esc(value)}</td>
    </tr>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">

        <tr><td style="background:${accent};padding:28px 32px;color:#ffffff;">
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.75;">${esc(brand.documentTitle)}</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px;">${esc(brand.name)}</div>
          <div style="font-size:22px;font-weight:700;margin-top:14px;">#${esc(data.invoiceNumber)}</div>
        </td></tr>

        <tr><td style="padding:28px 32px 8px;">
          ${
            data.message?.trim()
              ? `<div style="margin:0 0 22px;font-size:14px;line-height:23px;color:#404040;white-space:pre-line;">${esc(
                  data.message.trim()
                )}</div>`
              : `<p style="margin:0 0 14px;font-size:15px;color:#171717;">Dear ${esc(data.customerName)},</p>
                 <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#525252;">
                   Here is your ${esc(brand.documentTitle.toLowerCase())} from ${esc(brand.name)}, with the full details below.
                 </p>`
          }

          <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#a3a3a3;padding-bottom:6px;">
            ${esc(brand.documentTitle)} summary
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ededed;">
            ${row("Invoice date", day.format(new Date(data.invoiceDate)))}
            ${row("Due date", day.format(new Date(data.dueDate)))}
            ${row("Description", data.itemDescription)}
            ${row("Total", inr.format(data.total), true)}
            ${data.amountPaid > 0 ? row("Received", `- ${inr.format(data.amountPaid)}`) : ""}
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
            <tr><td style="background:${settled ? "#ecfdf5" : "#fafafa"};border-radius:8px;padding:14px 16px;">
              <table role="presentation" width="100%">
                <tr>
                  <td style="font-size:15px;font-weight:700;color:${settled ? "#047857" : "#171717"};">
                    ${settled ? "Paid in full" : "Balance due"}
                  </td>
                  <td style="text-align:right;font-size:15px;font-weight:700;color:${settled ? "#047857" : "#171717"};">
                    ${esc(inr.format(Math.max(balance, 0)))}
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        ${
          brand.bank
            ? `<tr><td style="padding:8px 32px 0;">
                 <div style="font-size:13px;font-weight:600;color:#404040;margin-bottom:4px;">Bank account details</div>
                 <div style="font-size:13px;line-height:20px;color:#525252;">
                   ${esc(brand.bank.accountName)}<br>
                   A/c ${esc(brand.bank.accountNumber)} &middot; IFSC ${esc(brand.bank.ifsc)}<br>
                   ${esc(brand.bank.bankName)} (${esc(brand.bank.accountType)})
                 </div>
               </td></tr>`
            : ""
        }

        ${
          data.notes
            ? `<tr><td style="padding:20px 32px 0;">
                 <div style="font-size:13px;line-height:20px;color:#525252;">${esc(data.notes)}</div>
               </td></tr>`
            : ""
        }
        ${
          data.terms
            ? `<tr><td style="padding:14px 32px 0;">
                 <div style="font-size:12px;font-weight:600;color:#404040;">Terms &amp; conditions</div>
                 <div style="font-size:12px;line-height:19px;color:#737373;white-space:pre-line;">${esc(data.terms)}</div>
               </td></tr>`
            : ""
        }

        <tr><td style="padding:24px 32px 28px;">
          <div style="border-top:1px solid #ededed;padding-top:16px;font-size:12px;line-height:19px;color:#a3a3a3;">
            ${esc(brand.name)}<br>
            ${brand.addressLines.map((l) => esc(l)).join("<br>")}
            ${brand.gstRegistered ? `<br>GSTIN ${esc(brand.gstin ?? "")}` : ""}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
