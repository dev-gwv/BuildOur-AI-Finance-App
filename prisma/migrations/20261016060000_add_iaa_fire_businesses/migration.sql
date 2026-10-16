-- Adds two businesses: IAA Bhavesh and Fire Himeesh.
-- Safe to re-run: a business whose slug already exists is left untouched.
-- Both are flagged needsReview so an admin confirms entity, series and GST in
-- Settings -> Businesses. Their Google Sheets are connected there too.

INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
SELECT 'biz_iaa_bhavesh', 'IAA Bhavesh', 'iaa-bhavesh', 'GRATEFUL', '#10b981', 'IAA-INV-', 1001, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Company" WHERE "slug" = 'iaa-bhavesh');

INSERT INTO "Company" ("id", "name", "slug", "entity", "color", "invoicePrefix", "invoiceNextNumber", "needsReview", "createdAt")
SELECT 'biz_fire_himeesh', 'Fire Himeesh', 'fire-himeesh', 'GRATEFUL', '#f97316', 'FIRE-INV-', 1001, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Company" WHERE "slug" = 'fire-himeesh');
