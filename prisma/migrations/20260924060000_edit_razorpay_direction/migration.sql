-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'IN';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "revisedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "gateway" TEXT,
ADD COLUMN "gatewayRef" TEXT,
ADD COLUMN "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "feeGstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceSettings" ADD COLUMN "razorpayFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN "razorpayFeeGstPercent" DOUBLE PRECISION NOT NULL DEFAULT 18;

-- CreateTable
CREATE TABLE "SheetSyncFailure" (
    "id" TEXT NOT NULL,
    "ledger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SheetSyncFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SheetSyncFailure_resolvedAt_idx" ON "SheetSyncFailure"("resolvedAt");

-- CreateIndex
CREATE INDEX "SheetSyncFailure_recordId_idx" ON "SheetSyncFailure"("recordId");
