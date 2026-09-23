-- One concept, "Business", replaces Company / Brand / Venture as the unit the
-- app is organised by. The Company table keeps its name (Prisma maps
-- Business onto it) so ids, members, categories, gateways and entries carry
-- over untouched. Every business this migration creates or matches is flagged
-- needsReview, so an admin confirms its legal entity, series and sheet once.
--
-- Written to be safe to run again after a failed attempt: columns, indexes
-- and constraints are only added if missing, and slugs are only assigned
-- where they aren't set yet.

-- Helpers, dropped with the session ------------------------------------------

-- The first of base, base-2, base-3 ... that no other business holds.
CREATE FUNCTION pg_temp.free_slug(base TEXT, own_id TEXT) RETURNS TEXT AS $$
DECLARE
  candidate TEXT := base;
  n INT := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM "Company" WHERE "slug" = candidate AND "id" <> own_id) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- Gives `slug` to `owner`, moving any other holder to a free "<slug>-old" key.
CREATE FUNCTION pg_temp.claim_slug(target TEXT, owner TEXT) RETURNS VOID AS $$
DECLARE
  holder TEXT;
BEGIN
  SELECT "id" INTO holder FROM "Company" WHERE "slug" = target AND "id" <> owner;
  IF holder IS NOT NULL THEN
    UPDATE "Company" SET "slug" = pg_temp.free_slug(target || '-old', holder) WHERE "id" = holder;
  END IF;
  UPDATE "Company" SET "slug" = target WHERE "id" = owner;
END;
$$ LANGUAGE plpgsql;

-- Of the businesses whose name matches, the one with the most activity
-- (entries, categories, members), oldest first on a tie. Several companies can
-- share a name; the one people actually use is the one to keep working in.
CREATE FUNCTION pg_temp.best_match(pattern TEXT, exclude TEXT[]) RETURNS TEXT AS $$
  SELECT c."id"
  FROM "Company" c
  WHERE c."name" ~* pattern AND NOT (c."id" = ANY (exclude))
  ORDER BY
    (SELECT count(*) FROM "Expense" e WHERE e."companyId" = c."id")
      + (SELECT count(*) FROM "Category" k WHERE k."companyId" = c."id")
      + (SELECT count(*) FROM "CompanyMember" m WHERE m."companyId" = c."id") DESC,
    c."createdAt" ASC,
    c."id" ASC
  LIMIT 1;
$$ LANGUAGE sql;

-- 1. Business settings on the existing table ---------------------------------
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "entity" "InvoiceBrand" NOT NULL DEFAULT 'GRATEFUL',
  ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT '#6a6cf0',
  ADD COLUMN IF NOT EXISTS "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
  ADD COLUMN IF NOT EXISTS "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "sheetUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "sheetSecretEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Slugs from names ("Grateful World Ventures" -> "grateful-world-ventures"),
-- oldest first, each checked against every slug already given out.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT "id", "name" FROM "Company" WHERE "slug" IS NULL ORDER BY "createdAt", "id" LOOP
    UPDATE "Company"
    SET "slug" = pg_temp.free_slug(
      left(COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(r."name"), '[^a-z0-9]+', '-', 'g')), ''), 'business'), 40),
      r."id")
    WHERE "id" = r."id";
  END LOOP;
END $$;

-- Anything that existed before this migration gets reviewed once.
UPDATE "Company" SET "needsReview" = true;
-- A company named after Mulberry bills as Mulberry.
UPDATE "Company" SET "entity" = 'MULBERRY', "color" = '#e11d48' WHERE "name" ~* 'mulberry';

-- 2. Invoices get a business --------------------------------------------------
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "SheetSyncFailure" ADD COLUMN IF NOT EXISTS "businessId" TEXT;

DO $$
DECLARE
  ipc_id TEXT;
  iwc_id TEXT;
  mulberry_id TEXT;
  grateful_id TEXT;
  has_venture BOOLEAN := EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'Invoice' AND column_name = 'venture');
  has_ledger BOOLEAN := EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'SheetSyncFailure' AND column_name = 'ledger');
BEGIN
  -- Match an existing company by name first; create the business only if none fits.

  ipc_id := pg_temp.best_match('\mipc\M', ARRAY[]::TEXT[]);
  IF ipc_id IS NULL THEN
    ipc_id := 'biz_ipc_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
    VALUES (ipc_id, 'IPC Finance', pg_temp.free_slug('ipc-new', ipc_id), 'GRATEFUL', '#6a6cf0', 'IPC-INV-', 2242, true, CURRENT_TIMESTAMP);
  END IF;
  PERFORM pg_temp.claim_slug('ipc', ipc_id);
  UPDATE "Company" SET "entity" = 'GRATEFUL', "color" = '#6a6cf0', "invoicePrefix" = 'IPC-INV-', "invoiceNextNumber" = 2242 WHERE "id" = ipc_id;

  iwc_id := pg_temp.best_match('\miwc\M', ARRAY[ipc_id]);
  IF iwc_id IS NULL THEN
    iwc_id := 'biz_iwc_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
    VALUES (iwc_id, 'IWC Finance', pg_temp.free_slug('iwc-new', iwc_id), 'GRATEFUL', '#0ea5e9', 'IWC-INV-', 1001, true, CURRENT_TIMESTAMP);
  END IF;
  PERFORM pg_temp.claim_slug('iwc', iwc_id);
  UPDATE "Company" SET "entity" = 'GRATEFUL', "color" = '#0ea5e9', "invoicePrefix" = 'IWC-INV-', "invoiceNextNumber" = 1001 WHERE "id" = iwc_id;

  mulberry_id := pg_temp.best_match('mulberry', ARRAY[ipc_id, iwc_id]);
  IF mulberry_id IS NULL THEN
    mulberry_id := 'biz_mulberry_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
    VALUES (mulberry_id, 'The Mulberry Weddings', pg_temp.free_slug('mulberry-new', mulberry_id), 'MULBERRY', '#e11d48', 'INV-', 1121, true, CURRENT_TIMESTAMP);
  END IF;
  PERFORM pg_temp.claim_slug('mulberry', mulberry_id);
  UPDATE "Company" SET "entity" = 'MULBERRY', "color" = '#e11d48', "invoicePrefix" = 'INV-', "invoiceNextNumber" = 1121 WHERE "id" = mulberry_id;

  -- Grateful invoices raised before IPC/IWC existed: an existing "Grateful"
  -- company if there is one, else a business made to hold them — only if any exist.
  IF EXISTS (
    SELECT 1 FROM "Invoice"
    WHERE "brand" = 'GRATEFUL' AND "businessId" IS NULL
      AND (NOT has_venture OR (to_jsonb("Invoice") ->> 'venture') IS NULL OR (to_jsonb("Invoice") ->> 'venture') NOT IN ('IPC', 'IWC'))
  ) THEN
    grateful_id := pg_temp.best_match('grateful', ARRAY[ipc_id, iwc_id, mulberry_id]);
    IF grateful_id IS NULL THEN
      grateful_id := 'biz_grateful_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
      VALUES (grateful_id, 'Grateful World Ventures', pg_temp.free_slug('grateful-new', grateful_id), 'GRATEFUL', '#525252', 'INV-', 2242, true, CURRENT_TIMESTAMP);
    END IF;
    PERFORM pg_temp.claim_slug('grateful', grateful_id);
    UPDATE "Company" SET "entity" = 'GRATEFUL', "color" = '#525252', "invoicePrefix" = 'INV-', "invoiceNextNumber" = 2242 WHERE "id" = grateful_id;
  END IF;

  UPDATE "Invoice" i SET "businessId" = CASE
    WHEN i."brand" = 'MULBERRY' THEN mulberry_id
    WHEN has_venture AND (to_jsonb(i) ->> 'venture') = 'IPC' THEN ipc_id
    WHEN has_venture AND (to_jsonb(i) ->> 'venture') = 'IWC' THEN iwc_id
    ELSE grateful_id
  END
  WHERE i."businessId" IS NULL;

  -- A failed sheet write names its business now, not a ledger key.
  IF has_ledger THEN
    UPDATE "SheetSyncFailure" f SET "businessId" = CASE to_jsonb(f) ->> 'ledger'
      WHEN 'IPC' THEN ipc_id WHEN 'IWC' THEN iwc_id WHEN 'MULBERRY' THEN mulberry_id END
    WHERE f."businessId" IS NULL;
  END IF;
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
CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");

ALTER TABLE "Invoice" ALTER COLUMN "businessId" SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_businessId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "SheetSyncFailure" DROP COLUMN IF EXISTS "ledger";
ALTER TABLE "SheetSyncFailure" ALTER COLUMN "businessId" SET NOT NULL;

DROP INDEX IF EXISTS "Expense_companyId_venture_date_idx";
DROP INDEX IF EXISTS "Invoice_brand_createdAt_idx";
DROP INDEX IF EXISTS "Invoice_brand_venture_createdAt_idx";
ALTER TABLE "Expense" DROP COLUMN IF EXISTS "venture";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "venture";

CREATE INDEX IF NOT EXISTS "Expense_companyId_direction_date_idx" ON "Expense"("companyId", "direction", "date");
CREATE INDEX IF NOT EXISTS "Invoice_businessId_invoiceDate_idx" ON "Invoice"("businessId", "invoiceDate");
CREATE INDEX IF NOT EXISTS "Invoice_businessId_dueDate_idx" ON "Invoice"("businessId", "dueDate");
CREATE INDEX IF NOT EXISTS "Payment_paidOn_idx" ON "Payment"("paidOn");
CREATE INDEX IF NOT EXISTS "Payment_gatewayRef_idx" ON "Payment"("gatewayRef");

-- 5. Sessions that can be revoked, and deactivation ------------------------------
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
-- Emails are compared lowercased at sign-in; make stored ones match, unless
-- that would collide with another account (left for an admin to sort out).
UPDATE "User" u SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (SELECT 1 FROM "User" u2 WHERE u2."id" <> u."id" AND lower(u2."email") = lower(u."email"));

-- 6. Audit trail and rate limiting ----------------------------------------------
CREATE TABLE IF NOT EXISTS "AuditLog" (
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
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_userId_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
