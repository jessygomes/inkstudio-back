-- Workflow de demande d'integration salon -> user_tatoueur

-- 1) Enum de statut
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TeamRequestStatus') THEN
    CREATE TYPE "TeamRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED');
  END IF;
END $$;

-- 2) Table des demandes
CREATE TABLE IF NOT EXISTS "SalonTatoueurTeamRequest" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "tatoueurUserId" TEXT NOT NULL,
  "message" TEXT,
  "status" "TeamRequestStatus" NOT NULL DEFAULT 'PENDING',
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalonTatoueurTeamRequest_pkey" PRIMARY KEY ("id")
);

-- 3) Contraintes et indexes
CREATE UNIQUE INDEX IF NOT EXISTS "SalonTatoueurTeamRequest_salonId_tatoueurUserId_status_key"
  ON "SalonTatoueurTeamRequest"("salonId", "tatoueurUserId", "status");

CREATE INDEX IF NOT EXISTS "SalonTatoueurTeamRequest_salonId_idx"
  ON "SalonTatoueurTeamRequest"("salonId");

CREATE INDEX IF NOT EXISTS "SalonTatoueurTeamRequest_tatoueurUserId_idx"
  ON "SalonTatoueurTeamRequest"("tatoueurUserId");

CREATE INDEX IF NOT EXISTS "SalonTatoueurTeamRequest_status_idx"
  ON "SalonTatoueurTeamRequest"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SalonTatoueurTeamRequest_salonId_fkey'
  ) THEN
    ALTER TABLE "SalonTatoueurTeamRequest"
      ADD CONSTRAINT "SalonTatoueurTeamRequest_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SalonTatoueurTeamRequest_tatoueurUserId_fkey'
  ) THEN
    ALTER TABLE "SalonTatoueurTeamRequest"
      ADD CONSTRAINT "SalonTatoueurTeamRequest_tatoueurUserId_fkey"
      FOREIGN KEY ("tatoueurUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
