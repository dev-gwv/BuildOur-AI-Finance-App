import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/access";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error(err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) throw new ApiError(401, "Not authenticated");
  return { id: session.user.id, role: session.user.role };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
  return user;
}
