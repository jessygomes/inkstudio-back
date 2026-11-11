CREATE TYPE "TattooPractice" AS ENUM ('MACHINE', 'HANDPOKE', 'TRADITIONAL', 'OTHER');

ALTER TABLE "User"
  ADD COLUMN "allowSameDayBooking" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tattooPractices" "TattooPractice"[] DEFAULT ARRAY[]::"TattooPractice"[],
  ADD COLUMN "tattooPracticeDetails" TEXT;

ALTER TABLE "Tatoueur"
  ADD COLUMN "tattooPractices" "TattooPractice"[] DEFAULT ARRAY[]::"TattooPractice"[],
  ADD COLUMN "tattooPracticeDetails" TEXT;

ALTER TABLE "Appointment"
  ADD COLUMN "projectBudgetMinCents" INTEGER,
  ADD COLUMN "projectBudgetMaxCents" INTEGER,
  ADD COLUMN "isFirstTattoo" BOOLEAN;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_project_client_info_check" CHECK (
  ("projectBudgetMinCents" IS NULL OR "projectBudgetMinCents" >= 0)
  AND ("projectBudgetMaxCents" IS NULL OR "projectBudgetMaxCents" >= 0)
  AND ("projectBudgetMinCents" IS NULL OR "projectBudgetMaxCents" IS NULL OR "projectBudgetMinCents" <= "projectBudgetMaxCents")
  AND (prestation = 'PROJET' OR ("projectBudgetMinCents" IS NULL AND "projectBudgetMaxCents" IS NULL AND "isFirstTattoo" IS NULL))
);
