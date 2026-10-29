CREATE TABLE "UploadedFile" (
    "application" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("application", "key")
);
CREATE INDEX "UploadedFile_ownerUserId_idx" ON "UploadedFile"("ownerUserId");
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
