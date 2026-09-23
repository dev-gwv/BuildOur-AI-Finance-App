// The business runs on Indian time. Stored dates are calendar days at midnight
// UTC, so "today" must be worked out on the Indian calendar, not the server's
// or browser's UTC clock — otherwise between 00:00 and 05:30 IST every new
// form, due-date check and "this month" would still be on yesterday.

const IST = "Asia/Kolkata";

/** Today's date in India as YYYY-MM-DD (for form defaults). */
export function todayISO(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Midnight UTC of today's Indian calendar date — directly comparable with stored dates. */
export function startOfTodayIST(now: Date = new Date()): Date {
  return new Date(`${todayISO(now)}T00:00:00.000Z`);
}
