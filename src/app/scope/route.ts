import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessBusiness } from "@/server/access";
import { prisma } from "@/lib/prisma";
import { ALL, SCOPE_COOKIE } from "@/server/scope";
import { safeNextPath } from "@/server/safeRedirect";

/**
 * GET /scope?b=<slug|all>&next=/invoices — switches the business being worked
 * in and returns to `next`. A plain link, so the switcher works without JS and
 * old bookmarks (/ipc, /mulberry) can redirect through it.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("b") ?? ALL;
  // Only same-site paths, so this can't be used as an open redirect.
  const next = safeNextPath(url.searchParams.get("next"));

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  let value = ALL;
  if (slug !== ALL) {
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true } });
    if (business && (await canAccessBusiness({ id: session.user.id, role: session.user.role, name: "" }, business.id))) {
      value = slug;
    }
  }

  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(SCOPE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
