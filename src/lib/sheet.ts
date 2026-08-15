type SheetSync =
  | {
      action: "add";
      id: string;
      /** YYYY-MM-DD — the sheet holds one tab per month and files it by this. */
      date: string;
      client: string;
      amount: number;
      remarks: string;
    }
  | { action: "remove"; id: string };

/**
 * Mirrors a payment into the Google Sheet the studio keeps its hisaab in.
 *
 * The sheet is written by an Apps Script web app (google-apps-script/PaymentSync.gs)
 * that runs as the account owning the workbook, so there is no service account
 * or key here — just a URL and a shared secret.
 *
 * Never throws. The payment is already in the database by the time this runs,
 * and a sheet that's unreachable must not make it look like the money wasn't
 * received. Failures are logged for the deployment log to show.
 */
export async function syncPaymentToSheet(body: SheetSync): Promise<void> {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, ...body }),
    });
    // Apps Script answers 200 with an error payload as readily as it fails
    // outright, so both are worth seeing.
    const text = await res.text();
    if (!res.ok || text.includes('"ok":false')) {
      console.error(`Sheet sync failed for payment ${body.id}: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (error) {
    console.error(`Sheet sync failed for payment ${body.id}:`, error);
  }
}
