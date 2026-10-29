-- Google accounts are linked only after server-side ID token verification.
-- Existing accounts remain unlinked until their next authorized Google login.
ALTER TABLE "User" ADD COLUMN "googleSubject" TEXT;
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
