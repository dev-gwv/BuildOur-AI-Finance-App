-- A third legal entity: Vertex Global Academy Private Limited (GSTIN 06AALCV6564G1ZX).
-- Its own migration: a new enum value can't be used in the transaction that adds it.
ALTER TYPE "InvoiceBrand" ADD VALUE IF NOT EXISTS 'VERTEX';
