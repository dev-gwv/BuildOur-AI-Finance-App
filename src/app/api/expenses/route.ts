import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany, getAccessibleCompanyIds } from "@/lib/access";
import { calculateBreakup, calculateCostBreakup } from "@/lib/calc";
import { saveUpload } from "@/lib/storage";
import { syncExpense } from "@/lib/sheet";
import { parseLedger } from "@/lib/ventures";

export const GET = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const accessible = await getAccessibleCompanyIds(user);

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const venture = parseLedger(searchParams.get("venture"));
  const directionParam = searchParams.get("direction");
  const direction = directionParam === "IN" || directionParam === "OUT" ? directionParam : null;

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
    where: { ...companyFilter, ...dateFilter, ...(venture ? { venture } : {}), ...(direction ? { direction } : {}) },
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
  // Money out is a cost: no gateway takes a cut of it.
  const direction = String(form.get("direction") ?? "IN") === "OUT" ? "OUT" : "IN";
  const gatewayId = direction === "IN" && form.get("gatewayId") ? String(form.get("gatewayId")) : null;
  const description = form.get("description") ? String(form.get("description")) : null;
  const dateStr = String(form.get("date") ?? "");
  const grossAmount = Number(form.get("grossAmount") ?? 0);
  const gstPercent = Number(form.get("gstPercent") ?? 0);
  const screenshot = form.get("screenshot");
  const venture = parseLedger(form.get("venture"));

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

  const breakup =
    direction === "OUT"
      ? { gatewayChargeAmount: 0, ...calculateCostBreakup({ grossAmount, gstPercent }) }
      : calculateBreakup({ grossAmount, gatewayChargePercent, gstPercent });

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
      venture,
      direction,
      createdById: user.id,
    },
    include: { category: { select: { name: true } } },
  });

  // Keeps the venture's workbook (and so its P&L) current without re-keying.
  if (venture) after(() => syncExpense(expense.id));

  return NextResponse.json({ expense }, { status: 201 });
});
