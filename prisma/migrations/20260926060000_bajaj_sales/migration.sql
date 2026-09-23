-- Bajaj Finance sales are their own kind of invoice: Bajaj pays the financed
-- amount later and keeps its dealer charges, so they can't be marked "paid in
-- full" the moment they're raised. Safe to run again.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "saleType" TEXT NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN IF NOT EXISTS "downPayment" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "financedAmount" DOUBLE PRECISION;

-- Invoices raised from a DO, or already settled by a Bajaj disbursement, are
-- Bajaj sales. Their recorded payments are left exactly as they are.
UPDATE "Invoice" i
SET "saleType" = 'BAJAJ',
    "financedAmount" = COALESCE(i."financedAmount", i."grossAmount")
WHERE i."saleType" = 'DIRECT'
  AND (
    i."doId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "Payment" p WHERE p."invoiceId" = i."id" AND p."method" = 'Bajaj Finance disbursement')
  );
