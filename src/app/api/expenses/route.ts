import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany, getAccessibleCompanyIds } from "@/lib/access";
import { calculateBreakup } from "@/lib/calc";
import { saveUpload } from "@/lib/storage";

export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const accessible = await getAccessibleCompanyIds(user);

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (companyId && !(await canAccessCompany(user, companyId))) {
    throw new ApiError(403, "No access to this company");
  }

  const companyFilter = companyId
    ? { companyId }
    : accessible === "ALL"
      ? {}
      : { companyId: { in: accessible } };

  const dateFilter =
    from || to
      ? {
          date: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const expenses = await prisma.expense.findMany({
    where: { ...companyFilter, ...dateFilter },
    orderBy: { date: "desc" },
    include: {
      company: { select: { name: true } },
      category: { select: { name: true } },
      gateway: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  return NextResponse.json({ expenses });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const form = await req.formData();

  const companyId = String(form.get("companyId") ?? "");
  const categoryId = String(form.get("categoryId") ?? "");
  const gatewayId = form.get("gatewayId") ? String(form.get("gatewayId")) : null;
  const description = form.get("description") ? String(form.get("description")) : null;
  const dateStr = String(form.get("date") ?? "");
  const grossAmount = Number(form.get("grossAmount") ?? 0);
  const gstPercent = Number(form.get("gstPercent") ?? 0);
  const screenshot = form.get("screenshot");

  if (!companyId || !categoryId || !dateStr || !grossAmount) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!(await canAccessCompany(user, companyId))) {
    throw new ApiError(403, "No access to this company");
  }

  let gatewayChargePercent = 0;
  if (gatewayId) {
    const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
    if (!gateway || gateway.companyId !== companyId) {
      return NextResponse.json({ error: "Invalid gateway" }, { status: 400 });
    }
    gatewayChargePercent = gateway.chargePercent;
  }

  const breakup = calculateBreakup({ grossAmount, gatewayChargePercent, gstPercent });

  let screenshotPath: string | null = null;
  if (screenshot instanceof File && screenshot.size > 0) {
    screenshotPath = await saveUpload(screenshot);
  }

  const expense = await prisma.expense.create({
    data: {
      companyId,
      categoryId,
      gatewayId,
      description,
      date: new Date(dateStr),
      grossAmount,
      gatewayChargePercent,
      gatewayChargeAmount: breakup.gatewayChargeAmount,
      gstPercent,
      gstAmount: breakup.gstAmount,
      netAmount: breakup.netAmount,
      screenshotPath,
      createdById: user.id,
    },
  });

  return NextResponse.json({ expense }, { status: 201 });
});
