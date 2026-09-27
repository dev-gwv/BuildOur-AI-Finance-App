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
 *   Workbook            LAYOUT
 *   Mulberry Weddings   "MULBERRY"
 *   IPC Finance         "VENTURE"
 *   IWC Finance         "VENTURE"
 *
 * Setup (once per workbook):
 *   1. In the sheet: Extensions -> Apps Script, paste this in.
 *   2. Set SECRET to a fresh random string (a different one per workbook)
 *      and LAYOUT to this workbook's. Save.
 *   3. Deploy -> New deployment -> Web app, "Execute as: Me",
 *      "Who has access: Anyone", Deploy, and authorise it.
 *   4. In the app: Settings -> Businesses -> the business -> Google Sheet,
 *      paste the /exec URL and the same secret, and press Test.
 *
 * After editing this file, Deploy -> Manage deployments -> edit -> New version,
 * otherwise the live URL keeps running the old code.
 */

// ---- Settings: the only part that differs between workbooks ---------------

/** Must match this workbook's secret in the app (Settings -> Businesses -> Google Sheet). */
var SECRET = "CHANGE-ME";

/**
 * Which workbook this is. Pick one:
 *   "VENTURE"  - IPC Finance / IWC Finance: one tab per month ("September 2026"),
 *                receipts in A-F and expenses in G-J, side by side:
 *                Date | Client Name | Payment Received | Excluding Payment Gateway Charges
 *                | Excluding Gst & Charges | Remarks || Date | Expenses | Incl Gst | Excluding Gst
 *   "MULBERRY" - Mulberry Weddings hisaab: one tab per month,
 *                (Receipts) Date | Client | Amount Received | Remarks, no expense sync.
 */
var LAYOUT = "VENTURE";

var LAYOUTS = {
  VENTURE: {
    // Fields the app sends for a receipt: date, client, amount (what the customer
    // paid), amountExCharges (after the gateway's / Bajaj's cut), amountExGst
    // (that, with GST taken back out), remarks.
    receiptColumns: ["date", "client", "amount", "amountExCharges", "amountExGst", "remarks"],
    receiptHeader: ["Date", "Client Name", "Payment Received", "Excluding Payment Gateway Charges", "Excluding Gst & Charges", "Remarks"],
    // For an expense: date, particular, amount (incl. GST), amountExGst.
    expenseFirstColumn: 7, // G
    expenseColumns: ["date", "particular", "amount", "amountExGst"],
    expenseHeader: ["Date", "Expenses", "Incl Gst", "Excluding Gst"],
    singleTab: "", // one tab per month (see monthSheet)
    newTabName: "{Month} {Year}",
  },
  MULBERRY: {
    receiptColumns: ["date", "client", "amount", "remarks"],
    receiptHeader: ["(Receipts) Date", "Client", "Amount Received ", "Remarks"],
    expenseFirstColumn: 0, // 0 turns expense sync off
    expenseColumns: ["date", "amount", "amountExGst"],
    expenseHeader: [],
    singleTab: "", // one tab per month (see monthSheet)
    newTabName: "Hisaab till {Month} {Year}",
  },
};

var CONFIG = LAYOUTS[LAYOUT];
var RECEIPT_COLUMNS = CONFIG.receiptColumns;
var RECEIPT_HEADER = CONFIG.receiptHeader;
var EXPENSE_FIRST_COLUMN = CONFIG.expenseFirstColumn;
var EXPENSE_COLUMNS = CONFIG.expenseColumns;
var EXPENSE_HEADER = CONFIG.expenseHeader;
/** A tab name to write everything into; "*" is the first tab. Empty means one tab per month. */
var SINGLE_TAB = CONFIG.singleTab;
/** What a missing month's tab is called when this script creates it. */
var NEW_TAB_NAME = CONFIG.newTabName;

/** Column P: clear of the tables the tabs keep side by side. Can be hidden. */
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
    if (field === "amount" || field === "amountExCharges" || field === "amountExGst") {
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
  if (SINGLE_TAB === "*") return ss.getSheets()[0];
  return ss.getSheetByName(SINGLE_TAB) || withHeaders(ss.insertSheet(SINGLE_TAB));
}

/** A tab this script had to create gets the same headings as the workbook's own. */
function withHeaders(sheet) {
  sheet.getRange(1, 1, 1, RECEIPT_HEADER.length).setValues([RECEIPT_HEADER]);
  if (EXPENSE_FIRST_COLUMN && EXPENSE_HEADER.length) {
    sheet.getRange(1, EXPENSE_FIRST_COLUMN, 1, EXPENSE_HEADER.length).setValues([EXPENSE_HEADER]);
  }
  return sheet;
}

/**
 * The tab this month's rows belong in, matched on the full month name
 * (deliberately not "Sep", which would also match other text). Mulberry's
 * tabs are "Hisaab till 31st August" and half a dozen spellings of that, with
 * no year, so: a tab naming the month and the year wins; otherwise one naming
 * just the month, as long as it isn't another year's. Among several, the
 * right-most, which is the one most recently added. A month with no tab yet
 * gets one, with the table headings.
 */
function monthSheet(date) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var month = Utilities.formatDate(date, tz, "MMMM").toLowerCase();
  var year = String(date.getFullYear());
  var sheets = ss.getSheets();
  var named = sheets.filter(function (sheet) {
    return sheet.getName().toLowerCase().indexOf(month) !== -1;
  });
  var thisYear = named.filter(function (sheet) {
    return sheet.getName().indexOf(year) !== -1;
  });
  var noYear = named.filter(function (sheet) {
    return !/(19|20)\d\d/.test(sheet.getName());
  });
  var match = thisYear.length ? thisYear : noYear;
  if (match.length) return match[match.length - 1];

  var name = NEW_TAB_NAME.replace("{Month}", Utilities.formatDate(date, tz, "MMMM")).replace("{Year}", year);
  return withHeaders(ss.insertSheet(name, sheets.length));
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
