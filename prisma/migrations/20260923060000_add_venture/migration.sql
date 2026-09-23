-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "venture" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "venture" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_brand_venture_createdAt_idx" ON "Invoice"("brand", "venture", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_companyId_venture_date_idx" ON "Expense"("companyId", "venture", "date");
