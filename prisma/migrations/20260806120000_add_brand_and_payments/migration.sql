
-- CreateEnum
CREATE TYPE "InvoiceBrand" AS ENUM ('GRATEFUL', 'MULBERRY');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "brand" "InvoiceBrand" NOT NULL DEFAULT 'GRATEFUL';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "proofPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Invoice_brand_createdAt_idx" ON "Invoice"("brand", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

