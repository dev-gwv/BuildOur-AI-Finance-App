-- Line items, credit notes and cancellation, TDS and refunds, a GST filing
-- lock, per-financial-year numbering, and password reset links.
-- Additive only, and safe to run again.

-- Businesses -------------------------------------------------------------------
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN/{FY}/',
  ADD COLUMN IF NOT EXISTS "gstLockedThrough" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invoiceDigits" INTEGER NOT NULL DEFAULT 6;

-- Invoices ---------------------------------------------------------------------
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailedPdfPath" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ISSUED';

-- Payments ---------------------------------------------------------------------
ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'RECEIPT',
  ADD COLUMN IF NOT EXISTS "tdsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tdsSection" TEXT;

-- Line items -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsnSac" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "gstPercent" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceLine_invoiceId_fkey') THEN
    ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Every existing invoice becomes one line, exactly as it printed before.
INSERT INTO "InvoiceLine" ("id", "invoiceId", "position", "description", "hsnSac", "qty", "grossAmount", "gstPercent")
SELECT 'line_' || i."id", i."id", 0, i."itemDescription", i."hsnSac", i."qty", i."grossAmount", i."gstPercent"
FROM "Invoice" i
WHERE NOT EXISTS (SELECT 1 FROM "InvoiceLine" l WHERE l."invoiceId" = i."id");

-- Credit notes -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CreditNote" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "gstPercent" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_number_key" ON "CreditNote"("number");
CREATE INDEX IF NOT EXISTS "CreditNote_businessId_noteDate_idx" ON "CreditNote"("businessId", "noteDate");
CREATE INDEX IF NOT EXISTS "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditNote_businessId_fkey') THEN
    ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditNote_invoiceId_fkey') THEN
    ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Per-financial-year counters --------------------------------------------------
CREATE TABLE IF NOT EXISTS "InvoiceCounter" (
    "businessId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL,
    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("businessId", "series")
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceCounter_businessId_fkey') THEN
    ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Password reset links ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey') THEN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
