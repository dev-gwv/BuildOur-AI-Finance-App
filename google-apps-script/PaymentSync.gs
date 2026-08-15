/**
 * Writes payments recorded in the finance app into this workbook.
 *
 * This lives in the sheet rather than the app calling the Sheets API, so there
 * is no service account, no key file and nothing to rotate — the script already
 * runs as the account that owns the workbook.
 *
 * Setup (once):
 *   1. In the sheet: Extensions -> Apps Script, paste this in, save.
 *   2. Put the same random string in SECRET below and in the app's
 *      SHEETS_WEBHOOK_SECRET.
 *   3. Deploy -> New deployment -> Web app, "Execute as: Me",
 *      "Who has access: Anyone", Deploy, and authorise it.
 *   4. Copy the /exec URL into the app's SHEETS_WEBHOOK_URL.
 *
 * After editing this file, Deploy -> Manage deployments -> edit -> New version,
 * otherwise the live URL keeps running the old code.
 */

/** Must match SHEETS_WEBHOOK_SECRET in the app. */
var SECRET = "CHANGE-ME";

/** Column P: clear of the three tables the hisaab tabs keep side by side. */
var ID_COLUMN = 16;

var HEADER = ["(Receipts) Date", "Client", "Amount Received ", "Remarks"];

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: "forbidden" });

  // Two payments saved at the same moment must not be handed the same row.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return reply(body.action === "remove" ? removePayment(body.id) : addPayment(body));
  } finally {
    lock.releaseLock();
  }
}

/** Open the /exec URL in a browser to check the deployment is live. */
function doGet() {
  return reply({ ok: true, workbook: SpreadsheetApp.getActive().getName() });
}

function addPayment(payment) {
  var parts = String(payment.date).split("-"); // YYYY-MM-DD, as the app sends it
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var sheet = monthSheet(date);
  var row = nextFreeRow(sheet);

  sheet
    .getRange(row, 1, 1, 4)
    .setValues([[date, payment.client, Number(payment.amount), payment.remarks || ""]]);
  // A real date, so it sorts — but shown the way the rows above it are shown,
  // since the sheet's own default renders the same day as 15/08/2026.
  sheet.getRange(row, 1).setNumberFormat("dd-mm-yyyy");
  // Kept out to the side so a payment deleted in the app can be found again.
  sheet.getRange(row, ID_COLUMN).setValue(payment.id);

  return { ok: true, sheet: sheet.getName(), row: row };
}

/**
 * The tab this month's receipts belong in. The workbook keeps one per month,
 * named "Hisaab till 31st August" and, over the years, half a dozen spellings
 * of that — so match on the month name and take the right-most, which is the
 * one most recently added. A month with no tab yet gets one.
 */
function monthSheet(date) {
  var ss = SpreadsheetApp.getActive();
  var month = Utilities.formatDate(date, ss.getSpreadsheetTimeZone(), "MMMM");
  var matches = ss.getSheets().filter(function (sheet) {
    return sheet.getName().toLowerCase().indexOf(month.toLowerCase()) !== -1;
  });
  if (matches.length) return matches[matches.length - 1];

  var sheet = ss.insertSheet("Hisaab till " + month + " " + date.getFullYear());
  sheet.appendRow(HEADER);
  return sheet;
}

/**
 * The first row with all four receipt cells free. Rows are never inserted:
 * the expenses sit in their own columns alongside, and shifting them down
 * would put every one of them against the wrong row.
 */
function nextFreeRow(sheet) {
  var rows = Math.max(sheet.getLastRow(), 1);
  var values = sheet.getRange(1, 1, rows, 4).getValues();
  var last = 0;
  for (var i = 0; i < values.length; i++) {
    if (values[i].join("") !== "") last = i + 1;
  }
  return last + 1;
}

/**
 * Empties the row a deleted payment was written to. The cells are cleared
 * rather than the row deleted, for the same reason nothing is ever inserted.
 */
function removePayment(id) {
  var sheets = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var rows = sheets[i].getLastRow();
    if (rows < 1) continue;
    var ids = sheets[i].getRange(1, ID_COLUMN, rows, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if (ids[r][0] === id) {
        sheets[i].getRange(r + 1, 1, 1, 4).clearContent();
        sheets[i].getRange(r + 1, ID_COLUMN).clearContent();
        return { ok: true, sheet: sheets[i].getName(), row: r + 1 };
      }
    }
  }
  return { ok: true, removed: false };
}

function reply(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
