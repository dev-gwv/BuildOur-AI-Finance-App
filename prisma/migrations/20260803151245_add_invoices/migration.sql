-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "placeOfSupply" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "hsnSac" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "notes" TEXT,
    "terms" TEXT,
    "doId" TEXT,
    "doDate" TIMESTAMP(3),
    "doFilePath" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

