import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, withApiErrors } from "@/lib/api-auth";

export const GET = withApiErrors(async () => {
  await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      companies: { select: { companyId: true } },
    },
  });
  return NextResponse.json({ users });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  await requireAdmin();
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = body.role === "ADMIN" ? "ADMIN" : "MEMBER";

  if (!name || !email || password.length < 6) {
    return NextResponse.json(
      { error: "Name, email, and a password of at least 6 characters are required" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
  });

  return NextResponse.json({ user }, { status: 201 });
});
