import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/access";

/**
 * Server Component helper for pages under (app)/. The (app) layout already
 * redirects unauthenticated requests, but Next.js can render a page's own
 * async work concurrently with its layout, so a page-level session read can
 * still resolve null on rare/racy requests — redirect defensively instead of
 * asserting non-null.
 */
export async function requireSessionUser(): Promise<SessionUser & { name: string }> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return { id: session.user.id, role: session.user.role, name: session.user.name ?? "User" };
}
