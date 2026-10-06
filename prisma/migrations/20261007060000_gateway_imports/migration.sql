-- Gateways connected by uploading exported reports. Additive and idempotent.
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'api';

CREATE TABLE IF NOT EXISTS "GatewayTransaction" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "feeGstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gstAmount" DOUBLE PRECISION,
  "method" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "contact" TEXT,
  "vpa" TEXT,
  "description" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importedById" TEXT,
  CONSTRAINT "GatewayTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GatewayTransaction_provider_externalId_key" ON "GatewayTransaction"("provider", "externalId");
CREATE INDEX IF NOT EXISTS "GatewayTransaction_provider_paidAt_idx" ON "GatewayTransaction"("provider", "paidAt");
