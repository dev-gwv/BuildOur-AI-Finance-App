import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";

/**
 * An error whose message is safe to show the user. Anything else that escapes
 * a route is logged and answered with a generic 500, so internals never leak.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Per-field messages for forms, keyed by field name. */
    public fields?: Record<string, string>,
    /** Seconds until retrying makes sense (429s). */
    public retryAfter?: number
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new ApiError(400, message, fields);
export const forbidden = (message = "You don't have access to this") => new ApiError(403, message);
export const notFound = (what = "That record") => new ApiError(404, `${what} wasn't found`);
export const conflict = (message: string) => new ApiError(409, message);

/** Turns any thrown value into a response the client can act on. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, ...(err.fields ? { fields: err.fields } : {}) },
      { status: err.status, headers: err.retryAfter ? { "Retry-After": String(err.retryAfter) } : undefined }
    );
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    const first = err.issues[0];
    return NextResponse.json({ error: first?.message ?? "Some details are invalid", fields }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Known database outcomes that are the request's fault, not the server's.
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | string | undefined)?.toString() ?? "value";
      return NextResponse.json({ error: `That ${target.replace(/[_"]/g, " ").trim()} is already in use` }, { status: 409 });
    }
    if (err.code === "P2025") return NextResponse.json({ error: "That record no longer exists" }, { status: 404 });
    if (err.code === "P2003") {
      return NextResponse.json({ error: "That record is still used elsewhere, so it can't be changed or removed" }, { status: 409 });
    }
  }
  const id = crypto.randomUUID().slice(0, 8);
  console.error(`[${id}] Unhandled error:`, err);
  return NextResponse.json({ error: `Something went wrong on our side (ref ${id}). Please try again.` }, { status: 500 });
}

/** Wraps a route handler so every failure becomes a clean JSON response. */
export function withApiErrors<Args extends unknown[]>(handler: (...args: Args) => Promise<NextResponse | Response>) {
  return async (...args: Args): Promise<NextResponse | Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
