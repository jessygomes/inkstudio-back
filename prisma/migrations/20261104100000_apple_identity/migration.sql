-- Apple accounts are linked only after server-side identity token verification.
ALTER TABLE "User" ADD COLUMN "appleSubject" TEXT;
CREATE UNIQUE INDEX "User_appleSubject_key" ON "User"("appleSubject");
