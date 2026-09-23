/**
 * Writes payments (and, where enabled, expenses) recorded in the finance app
 * into this workbook. Every write is an upsert keyed on the app's record id,
 * kept in a column off to the side: editing a payment in the app rewrites its
 * row here, changing its date moves it to the right month's tab, and a retried
 * write never adds a duplicate.
 *
 * This lives in the sheet rather than the app calling the Sheets API, so there
 * is no service account, no key file and nothing to rotate — the script already
 * runs as the account that owns the workbook.
 *
 * One copy per workbook. The code is the same in each; only the settings block
 * below differs:
 *
 *   Workbook            App variables
 *   Mulberry Weddings   SHEETS_WEBHOOK_URL      / SHEETS_WEBHOOK_SECRET
 *   IPC Finance         SHEETS_WEBHOOK_URL_IPC  / SHEETS_WEBHOOK_SECRET_IPC
 *   IWC Finance         SHEETS_WEBHOOK_URL_IWC  / SHEETS_WEBHOOK_SECRET_IWC
 *
 * Setup (once per workbook):
 *   1. In the sheet: Extensions -> Apps Script, paste this in.
 *   2. Set SECRET to a fresh random string and put the same string in the
 *      app's matching *_SECRET variable. Use a different one per workbook.
 *   3. Set RECEIPT_COLUMNS (and the expense settings, if wanted) to match
 *      this workbook's layout. Save.
 *   4. Deploy -> New deployment -> Web app, "Execute as: Me",
 *      "Who has access: Anyone", Deploy, and authorise it.
 *   5. Copy the /exec URL into the app's matching *_URL variable.
 *
 * After editing this file, Deploy -> Manage deployments -> edit -> New version,
 * otherwise the live URL keeps running the old code.
 */

// ---- Settings: the only part that differs between workbooks ---------------

/** Must match this workbook's *_SECRET in the app. */
var SECRET = "CHANGE-ME";

/**
 * The receipts table, left to right from column A. Fields the app sends:
 * date, client, amount (GST-inclusive), amountExGst, remarks.
 */
// Mulberry's hisaab: (Receipts) Date | Client | Amount Received | Remarks
var RECEIPT_COLUMNS = ["date", "client", "amount", "remarks"];
// IWC / IPC Finance: Date | Client Name | Payment Received including Gst & Charges
//                    | Excluding Gst & Charges | Remarks
// var RECEIPT_COLUMNS = ["date", "client", "amount", "amountExGst", "remarks"];

/** Header for a month tab this script has to create. Same order as RECEIPT_COLUMNS. */
var RECEIPT_HEADER = ["(Receipts) Date", "Client", "Amount Received ", "Remarks"];
// var RECEIPT_HEADER = ["Date", "Client Name", "Payment Received including Gst & Charges", "Excluding Gst & Charges", "Remarks"];

/**
 * The expenses table. 0 turns expense sync off — the app's expenses are then
 * simply not written here. Fields the app sends: date, particular,
 * amount (GST-inclusive), amountExGst. Check the column against the workbook
 * before turning it on; a wrong one writes over whatever is there.
 */
var EXPENSE_FIRST_COLUMN = 0;
var EXPENSE_COLUMNS = ["date", "amount", "amountExGst"];
// IWC Finance (Date | Expenses Incl Gst | Excluding Gst, straight after the receipts):
// var EXPENSE_FIRST_COLUMN = 6; // F

/**
 * A tab name to write everything into, for a workbook kept as one running
 * sheet. Empty means one tab per month (see monthSheet).
 */
var SINGLE_TAB = "";

/** Column P: clear of the tables the tabs keep side by side. */
var ID_COLUMN = 16;
/** Column Q: where an expense's id is kept, next to the payments'. */
var EXPENSE_ID_COLUMN = 17;

// ---------------------------------------------------------------------------

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: "forbidden" });

  // Two records saved at the same moment must not be handed the same row.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    switch (body.action) {
      case "remove":
        return reply(removeRow(body.id, ID_COLUMN, 1, RECEIPT_COLUMNS.length));
      case "addExpense":
      case "upsertExpense":
        return reply(addExpense(body));
      case "removeExpense":
        return reply(
          EXPENSE_FIRST_COLUMN
            ? removeRow(body.id, EXPENSE_ID_COLUMN, EXPENSE_FIRST_COLUMN, EXPENSE_COLUMNS.length)
            : { ok: true, removed: false }
        );
      default: // "upsert", or "add" from before edits existed
        return reply(addPayment(body));
    }
  } finally {
    lock.releaseLock();
  }
}

/** Open the /exec URL in a browser to check the deployment is live. */
function doGet() {
  return reply({
    ok: true,
    workbook: SpreadsheetApp.getActive().getName(),
    receipts: RECEIPT_COLUMNS,
    expenses: EXPENSE_FIRST_COLUMN ? EXPENSE_COLUMNS : null,
  });
}

function addPayment(payment) {
  var date = parseDate(payment.date);
  var sheet = targetSheet(date);
  return upsertRow(sheet, 1, RECEIPT_COLUMNS, ID_COLUMN, date, payment);
}

function addExpense(expense) {
  // Not an error: the app sends every venture's expenses, and a workbook
  // without an expense table set up just doesn't take them.
  if (!EXPENSE_FIRST_COLUMN) return { ok: true, skipped: "expense sync is off for this workbook" };
  var date = parseDate(expense.date);
  var sheet = targetSheet(date);
  return upsertRow(sheet, EXPENSE_FIRST_COLUMN, EXPENSE_COLUMNS, EXPENSE_ID_COLUMN, date, expense);
}

/**
 * Rewrites the record's row where it already is, if it belongs in the same
 * tab; otherwise clears the old row and writes a fresh one in the right tab.
 */
function upsertRow(sheet, firstColumn, fields, idColumn, date, record) {
  var found = findRow(record.id, idColumn);
  if (found && found.sheet.getSheetId() === sheet.getSheetId()) {
    return writeRow(sheet, found.row, firstColumn, fields, idColumn, date, record);
  }
  if (found) {
    found.sheet.getRange(found.row, firstColumn, 1, fields.length).clearContent();
    found.sheet.getRange(found.row, idColumn).clearContent();
  }
  return writeRow(sheet, nextFreeRow(sheet, firstColumn, fields.length), firstColumn, fields, idColumn, date, record);
}

function writeRow(sheet, row, firstColumn, fields, idColumn, date, record) {
  var values = fields.map(function (field) {
    if (field === "date") return date;
    if (field === "amount" || field === "amountExGst") {
      return record[field] === undefined || record[field] === null ? "" : Number(record[field]);
    }
    return record[field] || "";
  });
  sheet.getRange(row, firstColumn, 1, fields.length).setValues([values]);

  // A real date, so it sorts — but shown the way the rows above it are shown,
  // since the sheet's own default renders the same day as 15/08/2026.
  var dateIndex = fields.indexOf("date");
  if (dateIndex !== -1) sheet.getRange(row, firstColumn + dateIndex).setNumberFormat("dd-mm-yyyy");
  // Kept out to the side so a record deleted in the app can be found again.
  sheet.getRange(row, idColumn).setValue(record.id);

  return { ok: true, sheet: sheet.getName(), row: row };
}

function parseDate(value) {
  var parts = String(value).split("-"); // YYYY-MM-DD, as the app sends it
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function targetSheet(date) {
  if (!SINGLE_TAB) return monthSheet(date);
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SINGLE_TAB) || ss.insertSheet(SINGLE_TAB);
}

/**
 * The tab this month's rows belong in. The workbook keeps one per month,
 * named "Hisaab till 31st August" and, over the years, half a dozen spellings
 * of that — so match on the full month name (deliberately not "Sep", which
 * would also match other text) and take the right-most, which is the one most
 * recently added. A month with no tab yet gets one.
 */
function monthSheet(date) {
  var ss = SpreadsheetApp.getActive();
  var month = Utilities.formatDate(date, ss.getSpreadsheetTimeZone(), "MMMM");
  var matches = ss.getSheets().filter(function (sheet) {
    return sheet.getName().toLowerCase().indexOf(month.toLowerCase()) !== -1;
  });
  if (matches.length) return matches[matches.length - 1];

  var sheet = ss.insertSheet("Hisaab till " + month + " " + date.getFullYear());
  sheet.getRange(1, 1, 1, RECEIPT_HEADER.length).setValues([RECEIPT_HEADER]);
  return sheet;
}

/**
 * The first row with every cell of the table free. Rows are never inserted:
 * the other tables sit in their own columns alongside, and shifting them down
 * would put every one of them against the wrong row.
 */
function nextFreeRow(sheet, firstColumn, width) {
  var rows = Math.max(sheet.getLastRow(), 1);
  var values = sheet.getRange(1, firstColumn, rows, width).getValues();
  var last = 0;
  for (var i = 0; i < values.length; i++) {
    if (values[i].join("") !== "") last = i + 1;
  }
  return last + 1;
}

/**
 * Empties the row a deleted record was written to. The cells are cleared
 * rather than the row deleted, for the same reason nothing is ever inserted.
 */
function removeRow(id, idColumn, firstColumn, width) {
  var found = findRow(id, idColumn);
  if (!found) return { ok: true, removed: false };
  found.sheet.getRange(found.row, firstColumn, 1, width).clearContent();
  found.sheet.getRange(found.row, idColumn).clearContent();
  return { ok: true, sheet: found.sheet.getName(), row: found.row };
}

/** Where a record id was written, searching every tab. */
function findRow(id, idColumn) {
  var sheets = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var rows = sheets[i].getLastRow();
    if (rows < 1 || sheets[i].getMaxColumns() < idColumn) continue;
    var ids = sheets[i].getRange(1, idColumn, rows, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if (ids[r][0] === id) return { sheet: sheets[i], row: r + 1 };
    }
  }
  return null;
}

function reply(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
