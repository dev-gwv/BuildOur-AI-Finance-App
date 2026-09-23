import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { accessibleBusinessIds, type BusinessAccess } from "./access";
import { businessSummarySelect, type BusinessSummary } from "./businesses";
import type { SessionUser } from "./session";

/**
 * The business the user is working in, picked from the switcher in the
 * sidebar and remembered in a cookie. Every list, report and "new" form reads
 * it: pick IPC Finance and the whole app is IPC Finance; pick "All" to see
 * every business you have access to side by side.
 */
export const SCOPE_COOKIE = "biz";
export const ALL = "all";

export interface Scope {
  /** Every business this user can see, for the switcher. */
  businesses: BusinessSummary[];
  /** The one being worked in, or null for "All businesses". */
  current: BusinessSummary | null;
  access: BusinessAccess;
}

export async function getScope(user: SessionUser): Promise<Scope> {
  const access = await accessibleBusinessIds(user);
  const businesses = await prisma.business.findMany({
    where: { archivedAt: null, ...(access === "ALL" ? {} : { id: { in: access } }) },
    select: businessSummarySelect,
    orderBy: { name: "asc" },
  });

  const slug = (await cookies()).get(SCOPE_COOKIE)?.value;
  let current = slug && slug !== ALL ? (businesses.find((b) => b.slug === slug) ?? null) : null;
  // Someone with a single business never needs "All".
  if (!current && businesses.length === 1) current = businesses[0];
  return { businesses, current, access };
}

/**
 * The `where` for rows belonging to the current scope: the chosen business,
 * or everything the user can access when "All" is selected. Pass the field
 * name for relations (e.g. payments filter through `invoice`).
 */
export function scopeWhere(scope: Scope): { businessId?: string | { in: string[] } } {
  if (scope.current) return { businessId: scope.current.id };
  return scope.access === "ALL" ? {} : { businessId: { in: scope.businesses.map((b) => b.id) } };
}
