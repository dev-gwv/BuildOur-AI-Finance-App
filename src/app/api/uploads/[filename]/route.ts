import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany } from "@/lib/access";
import { readUpload } from "@/lib/storage";

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

  const result = await readUpload(filename);
  if (!result?.stream) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000",
    },
  });
});
