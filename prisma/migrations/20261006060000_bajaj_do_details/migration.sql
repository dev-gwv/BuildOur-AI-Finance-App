-- The Bajaj DO's amount table, kept on the invoice. Additive and idempotent.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "doDetails" JSONB;
