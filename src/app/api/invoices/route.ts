import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-auth";
import { saveUpload } from "@/lib/storage";
import { syncPayment } from "@/lib/sheet";
import { parseVenture } from "@/lib/ventures";

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

  const brand = String(form.get("brand") ?? "GRATEFUL") === "MULBERRY" ? "MULBERRY" : "GRATEFUL";
  // IPC / IWC are ventures under Grateful's GSTIN — never under Mulberry.
  const venture = brand === "GRATEFUL" ? parseVenture(form.get("venture")) : null;
  const invoiceNumber = String(form.get("invoiceNumber") ?? "").trim();
  const invoiceDate = String(form.get("invoiceDate") ?? "");
  const dueDate = String(form.get("dueDate") ?? invoiceDate);
  const customerName = String(form.get("customerName") ?? "").trim();
  const customerAddress = String(form.get("customerAddress") ?? "").trim();
  const customerGstin = form.get("customerGstin") ? String(form.get("customerGstin")).trim() : null;
  const customerEmail = form.get("customerEmail") ? String(form.get("customerEmail")).trim() : null;
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
  /** Advance already received when the invoice is raised (Mulberry books deposits). */
  const advancePaid = Number(form.get("advancePaid") ?? 0);

  if (!invoiceNumber || !invoiceDate || !customerName || !itemDescription || !grossAmount) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (await prisma.invoice.findUnique({ where: { invoiceNumber } })) {
    throw new ApiError(400, `Invoice ${invoiceNumber} already exists`);
  }

  // Large files (quotation decks) are sent to storage from the browser and
  // arrive here as a name; smaller ones are still proxied through the server.
  let doFilePath: string | null = form.get("doFilePath")
    ? String(form.get("doFilePath")).trim()
    : null;
  if (!doFilePath && doFile instanceof File && doFile.size > 0) {
    doFilePath = await saveUpload(doFile);
  }

  // A Bajaj-financed sale (raised from its DO) is disbursed in full, so the
  // invoice is settled the moment it's raised. One raised from a GST
  // certificate is a direct B2B sale paid by UPI/bank like any other, so it
  // starts unpaid and its payments are recorded as they arrive. Mulberry
  // bookings are paid in instalments; only the advance received is recorded.
  const source = form.get("source") ? String(form.get("source")) : null;
  const bajajFinanced = brand === "GRATEFUL" && (source === "DO" || Boolean(doId));
  const initialPayment = bajajFinanced
    ? grossAmount
    : advancePaid > 0
      ? Math.min(advancePaid, grossAmount)
      : 0;

  const invoice = await prisma.invoice.create({
    data: {
      brand,
      venture,
      ...(initialPayment > 0
        ? {
            payments: {
              create: {
                amount: initialPayment,
                paidOn: new Date(invoiceDate),
                method: bajajFinanced ? "Bajaj Finance disbursement" : "Advance",
              },
            },
          }
        : {}),
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      customerName,
      customerAddress,
      customerEmail,
      customerGstin,
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
    include: { payments: true },
  });

  // The money received on raising the invoice belongs in the venture's (or
  // Mulberry's) sheet like any later instalment. Legacy Grateful invoices have
  // no workbook. Sent after the response so Apps Script's latency isn't the user's.
  const [payment] = invoice.payments;
  if (payment) after(() => syncPayment(payment.id));

  return NextResponse.json({ invoice }, { status: 201 });
});
