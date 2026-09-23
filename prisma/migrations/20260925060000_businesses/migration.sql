-- One concept, "Business", replaces Company / Brand / Venture as the unit the
-- app is organised by. The Company table keeps its name (Prisma maps
-- Business onto it) so ids, members, categories, gateways and entries carry
-- over untouched. Every business this migration creates or matches is flagged
-- needsReview, so an admin confirms its legal entity, series and sheet once.

-- 1. Business settings on the existing table ---------------------------------
ALTER TABLE "Company"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "entity" "InvoiceBrand" NOT NULL DEFAULT 'GRATEFUL',
  ADD COLUMN "color" TEXT NOT NULL DEFAULT '#6a6cf0',
  ADD COLUMN "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
  ADD COLUMN "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sheetUrl" TEXT,
  ADD COLUMN "sheetSecretEnc" TEXT,
  ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Slugs from names ("Grateful World Ventures" -> "grateful-world-ventures"),
-- made unique by suffixing part of the id where two names collide.
UPDATE "Company"
SET "slug" = COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'business');

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "slug" ORDER BY "createdAt", "id") AS rn
  FROM "Company"
)
UPDATE "Company" c
SET "slug" = c."slug" || '-' || substr(c."id", 1, 6)
FROM ranked r
WHERE r."id" = c."id" AND r.rn > 1;

-- Anything that existed before this migration gets reviewed once.
UPDATE "Company" SET "needsReview" = true;

-- 2. Invoices get a business --------------------------------------------------
ALTER TABLE "Invoice" ADD COLUMN "businessId" TEXT;

DO $$
DECLARE
  ipc_id TEXT;
  iwc_id TEXT;
  mulberry_id TEXT;
  grateful_id TEXT;
BEGIN
  -- Match an existing company by name first; create the business only if none fits.
  -- Slugs are claimed for the matched rows so the app can refer to them.

  SELECT "id" INTO ipc_id FROM "Company" WHERE "name" ~* '\mipc\M' ORDER BY "createdAt" LIMIT 1;
  IF ipc_id IS NULL THEN
    ipc_id := 'biz_ipc_' || substr(md5(random()::text), 1, 12);
    INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
    VALUES (ipc_id, 'IPC Finance', 'ipc', 'GRATEFUL', '#6a6cf0', 'IPC-INV-', 2242, true, CURRENT_TIMESTAMP);
  ELSE
    UPDATE "Company" SET "slug" = "slug" || '-old-' || substr("id", 1, 4) WHERE "slug" = 'ipc' AND "id" <> ipc_id;
    UPDATE "Company" SET "slug" = 'ipc', "entity" = 'GRATEFUL', "color" = '#6a6cf0', "invoicePrefix" = 'IPC-INV-', "invoiceNextNumber" = 2242 WHERE "id" = ipc_id;
  END IF;

  SELECT "id" INTO iwc_id FROM "Company" WHERE "name" ~* '\miwc\M' ORDER BY "createdAt" LIMIT 1;
  IF iwc_id IS NULL THEN
    iwc_id := 'biz_iwc_' || substr(md5(random()::text), 1, 12);
    INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
    VALUES (iwc_id, 'IWC Finance', 'iwc', 'GRATEFUL', '#0ea5e9', 'IWC-INV-', 1001, true, CURRENT_TIMESTAMP);
  ELSE
    UPDATE "Company" SET "slug" = "slug" || '-old-' || substr("id", 1, 4) WHERE "slug" = 'iwc' AND "id" <> iwc_id;
    UPDATE "Company" SET "slug" = 'iwc', "entity" = 'GRATEFUL', "color" = '#0ea5e9', "invoicePrefix" = 'IWC-INV-', "invoiceNextNumber" = 1001 WHERE "id" = iwc_id;
  END IF;

  SELECT "id" INTO mulberry_id FROM "Company" WHERE "name" ~* 'mulberry' ORDER BY "createdAt" LIMIT 1;
  IF mulberry_id IS NULL THEN
    mulberry_id := 'biz_mulberry_' || substr(md5(random()::text), 1, 12);
    INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
    VALUES (mulberry_id, 'The Mulberry Weddings', 'mulberry', 'MULBERRY', '#e11d48', 'INV-', 1121, true, CURRENT_TIMESTAMP);
  ELSE
    UPDATE "Company" SET "slug" = "slug" || '-old-' || substr("id", 1, 4) WHERE "slug" = 'mulberry' AND "id" <> mulberry_id;
    UPDATE "Company" SET "slug" = 'mulberry', "entity" = 'MULBERRY', "color" = '#e11d48', "invoicePrefix" = 'INV-', "invoiceNextNumber" = 1121 WHERE "id" = mulberry_id;
  END IF;

  -- Grateful invoices raised before IPC/IWC existed: an existing "Grateful"
  -- company if there is one, else a business made to hold them — only if any exist.
  IF EXISTS (SELECT 1 FROM "Invoice" WHERE "brand" = 'GRATEFUL' AND ("venture" IS NULL OR "venture" NOT IN ('IPC', 'IWC'))) THEN
    SELECT "id" INTO grateful_id FROM "Company"
      WHERE "name" ~* 'grateful' AND "id" NOT IN (ipc_id, iwc_id, mulberry_id)
      ORDER BY "createdAt" LIMIT 1;
    IF grateful_id IS NULL THEN
      grateful_id := 'biz_grateful_' || substr(md5(random()::text), 1, 12);
      INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
      VALUES (grateful_id, 'Grateful World Ventures', 'grateful', 'GRATEFUL', '#525252', 'INV-', 2242, true, CURRENT_TIMESTAMP);
    ELSE
      UPDATE "Company" SET "slug" = "slug" || '-old-' || substr("id", 1, 4) WHERE "slug" = 'grateful' AND "id" <> grateful_id;
      UPDATE "Company" SET "slug" = 'grateful', "entity" = 'GRATEFUL', "color" = '#525252', "invoicePrefix" = 'INV-', "invoiceNextNumber" = 2242 WHERE "id" = grateful_id;
    END IF;
  END IF;

  UPDATE "Invoice" SET "businessId" = CASE
    WHEN "brand" = 'MULBERRY' THEN mulberry_id
    WHEN "venture" = 'IPC' THEN ipc_id
    WHEN "venture" = 'IWC' THEN iwc_id
    ELSE grateful_id
  END;

  -- A failed sheet write names its business now, not a ledger key.
  ALTER TABLE "SheetSyncFailure" ADD COLUMN "businessId" TEXT;
  UPDATE "SheetSyncFailure" SET "businessId" = CASE "ledger"
    WHEN 'IPC' THEN ipc_id WHEN 'IWC' THEN iwc_id WHEN 'MULBERRY' THEN mulberry_id END;
  DELETE FROM "SheetSyncFailure" WHERE "businessId" IS NULL;
END $$;

-- 3. Each series continues from the highest number already issued in it --------
UPDATE "Company" c
SET "invoiceNextNumber" = GREATEST(c."invoiceNextNumber", sub.max_seq + 1)
FROM (
  SELECT i."businessId", MAX(NULLIF(regexp_replace(substr(i."invoiceNumber", length(b."invoicePrefix") + 1), '\D', '', 'g'), '')::BIGINT) AS max_seq
  FROM "Invoice" i
  JOIN "Company" b ON b."id" = i."businessId"
  WHERE i."invoiceNumber" LIKE b."invoicePrefix" || '%'
  GROUP BY i."businessId"
) sub
WHERE c."id" = sub."businessId" AND sub.max_seq IS NOT NULL;

-- 4. Constraints and indexes ---------------------------------------------------
ALTER TABLE "Company" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

ALTER TABLE "Invoice" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SheetSyncFailure" DROP COLUMN "ledger";
ALTER TABLE "SheetSyncFailure" ALTER COLUMN "businessId" SET NOT NULL;

DROP INDEX IF EXISTS "Expense_companyId_venture_date_idx";
DROP INDEX IF EXISTS "Invoice_brand_createdAt_idx";
DROP INDEX IF EXISTS "Invoice_brand_venture_createdAt_idx";
ALTER TABLE "Expense" DROP COLUMN "venture";
ALTER TABLE "Invoice" DROP COLUMN "venture";

CREATE INDEX "Expense_companyId_direction_date_idx" ON "Expense"("companyId", "direction", "date");
CREATE INDEX "Invoice_businessId_invoiceDate_idx" ON "Invoice"("businessId", "invoiceDate");
CREATE INDEX "Invoice_businessId_dueDate_idx" ON "Invoice"("businessId", "dueDate");
CREATE INDEX "Payment_paidOn_idx" ON "Payment"("paidOn");
CREATE INDEX "Payment_gatewayRef_idx" ON "Payment"("gatewayRef");

-- 5. Sessions that can be revoked, and deactivation ------------------------------
ALTER TABLE "User"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);
-- Emails are compared lowercased at sign-in; make stored ones match.
UPDATE "User" SET "email" = lower("email") WHERE "email" <> lower("email")
  AND NOT EXISTS (SELECT 1 FROM "User" u2 WHERE u2."email" = lower("User"."email"));

-- 6. Audit trail and rate limiting ----------------------------------------------
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "businessId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
