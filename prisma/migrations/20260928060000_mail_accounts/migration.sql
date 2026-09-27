-- Mailboxes the app sends email through, and which one each business uses
-- for its invoices. Additive only, and safe to run again. Until a mailbox is
-- added in Settings -> Integrations, the SMTP_* environment settings keep
-- working exactly as before.

CREATE TABLE IF NOT EXISTS "MailAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 465,
    "username" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MailAccount_email_key" ON "MailAccount"("email");

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "mailAccountId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Company_mailAccountId_fkey') THEN
    ALTER TABLE "Company" ADD CONSTRAINT "Company_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
