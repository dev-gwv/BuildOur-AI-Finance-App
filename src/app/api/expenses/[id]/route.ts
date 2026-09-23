import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { canAccessCompany } from "@/lib/access";
import { calculateBreakup, calculateCostBreakup } from "@/lib/calc";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { syncExpense, unsyncExpense } from "@/lib/sheet";
import { parseLedger } from "@/lib/ventures";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessCompany(user, expense.companyId))) {
    throw new ApiError(403, "No access to this expense");
  }

  return NextResponse.json({ expense });
});

export const PATCH = withApiErrors(async (req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessCompany(user, existing.companyId))) {
    throw new ApiError(403, "No access to this expense");
  }

  const form = await req.formData();
  const categoryId = String(form.get("categoryId") ?? existing.categoryId);
  const directionField = form.get("direction");
  const direction = directionField === null ? existing.direction : String(directionField) === "OUT" ? "OUT" : "IN";
  const gatewayId = direction === "IN" && form.get("gatewayId") ? String(form.get("gatewayId")) : null;
  const description = form.get("description") ? String(form.get("description")) : null;
  const dateStr = String(form.get("date") ?? "");
  const grossAmount = Number(form.get("grossAmount") ?? existing.grossAmount);
  const gstPercent = Number(form.get("gstPercent") ?? existing.gstPercent);
  const screenshot = form.get("screenshot");
  // Absent from the form means "unchanged", so older clients can't clear it by accident.
  const venture = form.has("venture") ? parseLedger(form.get("venture")) : parseLedger(existing.venture);

  let gatewayChargePercent = 0;
  if (gatewayId) {
    const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
    if (!gateway || gateway.companyId !== existing.companyId) {
      return NextResponse.json({ error: "Invalid gateway" }, { status: 400 });
    }
    gatewayChargePercent = gateway.chargePercent;
  }

  const breakup =
    direction === "OUT"
      ? { gatewayChargeAmount: 0, ...calculateCostBreakup({ grossAmount, gstPercent }) }
      : calculateBreakup({ grossAmount, gatewayChargePercent, gstPercent });

  let screenshotPath = existing.screenshotPath;
  if (screenshot instanceof File && screenshot.size > 0) {
    screenshotPath = await saveUpload(screenshot);
    if (existing.screenshotPath) {
      await deleteUpload(existing.screenshotPath).catch(() => {});
    }
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      categoryId,
      gatewayId,
      description,
      date: dateStr ? new Date(dateStr) : existing.date,
      grossAmount,
      gatewayChargePercent,
      gatewayChargeAmount: breakup.gatewayChargeAmount,
      gstPercent,
      gstAmount: breakup.gstAmount,
      netAmount: breakup.netAmount,
      screenshotPath,
      venture,
      direction,
    },
    include: { category: { select: { name: true } } },
  });

  // Upserted in place; if the venture or direction changed, the old row is cleared first.
  if (existing.venture || venture) {
    after(() => syncExpense(id, { venture: existing.venture, direction: existing.direction }));
  }

  return NextResponse.json({ expense });
});

export const DELETE = withApiErrors(async (_req: NextRequest, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canAccessCompany(user, expense.companyId))) {
    throw new ApiError(403, "No access to this expense");
  }

  await prisma.expense.delete({ where: { id } });
  if (expense.screenshotPath) {
    await deleteUpload(expense.screenshotPath).catch(() => {});
  }
  const ledger = parseLedger(expense.venture);
  if (ledger) after(() => unsyncExpense(ledger, expense.direction, id));
  return NextResponse.json({ ok: true });
});
