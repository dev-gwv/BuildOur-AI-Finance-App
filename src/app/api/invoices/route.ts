import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { saveUpload } from "@/lib/storage";

export const GET = withApiErrors(async () => {
  await requireUser();
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  return NextResponse.json({ invoices });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireUser();
  const form = await req.formData();

  const invoiceNumber = String(form.get("invoiceNumber") ?? "").trim();
  const invoiceDate = String(form.get("invoiceDate") ?? "");
  const dueDate = String(form.get("dueDate") ?? invoiceDate);
  const customerName = String(form.get("customerName") ?? "").trim();
  const customerAddress = String(form.get("customerAddress") ?? "").trim();
  const placeOfSupply = String(form.get("placeOfSupply") ?? "").trim();
  const itemDescription = String(form.get("itemDescription") ?? "").trim();
  const hsnSac = String(form.get("hsnSac") ?? "").trim();
  const qty = Number(form.get("qty") ?? 1);
  const grossAmount = Number(form.get("grossAmount") ?? 0);
  const gstPercent = Number(form.get("gstPercent") ?? 18);
  const notes = form.get("notes") ? String(form.get("notes")) : null;
  const terms = form.get("terms") ? String(form.get("terms")) : null;
  const doId = form.get("doId") ? String(form.get("doId")) : null;
  const doDateStr = form.get("doDate") ? String(form.get("doDate")) : "";
  const doFile = form.get("doFile");

  if (!invoiceNumber || !invoiceDate || !customerName || !itemDescription || !grossAmount) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (await prisma.invoice.findUnique({ where: { invoiceNumber } })) {
    throw new ApiError(400, `Invoice ${invoiceNumber} already exists`);
  }

  let doFilePath: string | null = null;
  if (doFile instanceof File && doFile.size > 0) {
    doFilePath = await saveUpload(doFile);
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      customerName,
      customerAddress,
      placeOfSupply,
      itemDescription,
      hsnSac,
      qty,
      grossAmount,
      gstPercent,
      notes,
      terms,
      doId,
      doDate: doDateStr ? new Date(doDateStr) : null,
      doFilePath,
      createdById: user.id,
    },
  });

  return NextResponse.json({ invoice }, { status: 201 });
});
