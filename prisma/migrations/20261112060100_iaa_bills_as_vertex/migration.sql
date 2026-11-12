-- IAA Bhavesh now bills as Vertex, numbered like Vertex's own invoices:
-- VGA/2026-27/048 onwards (047 was the last one raised outside the app).
-- Invoices already issued keep their seller (Invoice.brand is fixed at issue).
UPDATE "Company"
SET "entity" = 'VERTEX', "invoicePrefix" = 'VGA/{FY4}/', "invoiceDigits" = 3, "needsReview" = true
WHERE "slug" = 'iaa-bhavesh' AND "entity" <> 'VERTEX';

INSERT INTO "InvoiceCounter" ("businessId", "series", "next")
SELECT "id", 'VGA/2026-27/', 48 FROM "Company" WHERE "slug" = 'iaa-bhavesh'
ON CONFLICT ("businessId", "series") DO UPDATE SET "next" = GREATEST("InvoiceCounter"."next", 48);
