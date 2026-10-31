-- TDS the customer is expected to deduct, set on the invoice.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "tdsPercent" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "tdsSection" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "tdsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
