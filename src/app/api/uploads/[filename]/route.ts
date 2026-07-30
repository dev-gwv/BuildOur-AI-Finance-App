import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany } from "@/lib/access";
import { uploadPath } from "@/lib/storage";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

type Params = { params: Promise<{ filename: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { filename } = await params;

  if (!/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]{1,5}$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const expense = await prisma.expense.findFirst({
    where: { screenshotPath: filename },
    select: { companyId: true },
  });

  if (!expense) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canAccessCompany(user, expense.companyId))) {
    throw new ApiError(403, "No access to this file");
  }

  const buffer = await readFile(uploadPath(filename));
  const ext = path.extname(filename).toLowerCase();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000",
    },
  });
});
