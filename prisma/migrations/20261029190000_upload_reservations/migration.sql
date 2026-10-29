CREATE TABLE "UploadReservation" (
  "id" TEXT NOT NULL,
  "application" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "budgetKey" TEXT NOT NULL,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT,
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0),
  "contentType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("status" IN ('RESERVED','COMPLETE','CLEANING','DELETED')),
  "key" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attachedAt" TIMESTAMP(3),
  CONSTRAINT "UploadReservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadReservation_application_key_key" ON "UploadReservation"("application", "key");
CREATE INDEX "UploadReservation_budgetKey_createdAt_idx" ON "UploadReservation"("budgetKey", "createdAt");
CREATE INDEX "UploadReservation_status_createdAt_idx" ON "UploadReservation"("status", "createdAt");

CREATE INDEX "UploadReservation_ownerUserId_status_idx" ON "UploadReservation"("ownerUserId", "status");
CREATE INDEX "UploadReservation_key_idx" ON "UploadReservation"("key");
