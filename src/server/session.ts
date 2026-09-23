import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ApiError } from "./errors";

export type SessionUser = { id: string; role: string; name: string };

export const isAdmin = (user: SessionUser) => user.role === "ADMIN";

/** For route handlers: the signed-in user, or a 401. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new ApiError(401, "Your session has ended. Please sign in again.");
  return { id: session.user.id, role: session.user.role, name: session.user.name ?? "User" };
}

/** For route handlers: an admin, or a 403. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new ApiError(403, "Only an admin can do that");
  return user;
}

/**
 * For pages under (app)/. The layout already redirects signed-out visitors,
 * but a page's own work can run concurrently with its layout, so it checks too.
 */
export async function requirePageUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return { id: session.user.id, role: session.user.role, name: session.user.name ?? "User" };
}

/** For admin-only pages: members are sent to the dashboard. */
export async function requirePageAdmin(): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!isAdmin(user)) redirect("/dashboard");
  return user;
}
