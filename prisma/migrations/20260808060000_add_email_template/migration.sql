
-- CreateTable
CREATE TABLE "EmailTemplate" (
    "brand" "InvoiceBrand" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("brand")
);

