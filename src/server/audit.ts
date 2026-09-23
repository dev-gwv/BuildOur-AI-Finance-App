import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { clientIp } from "./rateLimit";
import type { SessionUser } from "./session";

/**
 * The audit trail: who created, changed or deleted what, and when. Money
 * records can be edited, so this is how a changed figure is explained later.
 * Never throws — an unwritable log line must not undo the change it describes.
 */
export async function audit(entry: {
  user: SessionUser | null;
  businessId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  req?: Request;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.user?.id ?? null,
        businessId: entry.businessId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary.slice(0, 500),
        changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: entry.req ? clientIp(entry.req.headers) : null,
      },
    });
  } catch (e) {
    console.error("Couldn't write the audit log:", e);
  }
}

const show = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
};

/**
 * The fields that actually changed between two versions of a record, with a
 * readable summary: "amount 117999 → 120000, customer A → B".
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  labels: Partial<Record<keyof T, string>>
): { changes: Record<string, { from: unknown; to: unknown }>; summary: string } {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const parts: string[] = [];
  for (const key of Object.keys(labels) as (keyof T)[]) {
    if (!(key in after)) continue;
    const a = before[key];
    const b = after[key];
    if (show(a) === show(b)) continue;
    changes[key as string] = { from: a instanceof Date ? show(a) : a, to: b instanceof Date ? show(b) : b };
    parts.push(`${labels[key]} ${show(a)} → ${show(b)}`);
  }
  return { changes, summary: parts.join(", ") };
}
