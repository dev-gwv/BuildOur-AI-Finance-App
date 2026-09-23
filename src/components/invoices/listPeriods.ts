import { GST_PERIODS, gstPeriodRange, type GstPeriodKey } from "@/lib/gstReport";

/** Period filters for the invoice and payment lists: the FY periods plus "All time". */
export const LIST_PERIODS = [{ key: "all", label: "All time" }, ...GST_PERIODS] as const;

export type ListPeriodKey = "all" | GstPeriodKey;

export function parseListPeriod(value: string | undefined): ListPeriodKey {
  return LIST_PERIODS.some((p) => p.key === value) ? (value as ListPeriodKey) : "all";
}

/** A Prisma date filter for the period, or undefined for all time. */
export function periodFilter(key: ListPeriodKey, now = new Date()): { gte: Date; lt: Date } | undefined {
  if (key === "all") return undefined;
  const { start, end } = gstPeriodRange(key, now);
  return { gte: start, lt: end };
}
