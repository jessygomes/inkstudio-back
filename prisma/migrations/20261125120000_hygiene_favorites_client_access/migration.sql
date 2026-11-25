-- Justificatifs d'hygiène des tatoueurs créés par un salon, favoris de flashs, favoris de moodboards
-- pour les professionnels, besoins d'un projet Explorer, accès du professionnel aux informations du client.
-- Migration uniquement additive.

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'ACCESS_REQUEST';

-- AlterTable
ALTER TABLE "Moodboard" ADD COLUMN "projectNeeds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "clientAccess" TEXT,
ADD COLUMN "clientAlias" TEXT,
ADD COLUMN "clientAccessRequestedAt" TIMESTAMP(3),
ADD COLUMN "clientAccessRespondedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TatoueurHygieneDocument" (
    "id" TEXT NOT NULL,
    "tatoueurId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "VerificationStatusDocument" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "TatoueurHygieneDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteFlash" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "flashId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteFlash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodboardFavorite" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "moodboardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodboardFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TatoueurHygieneDocument_tatoueurId_key" ON "TatoueurHygieneDocument"("tatoueurId");
CREATE INDEX "TatoueurHygieneDocument_status_uploadedAt_idx" ON "TatoueurHygieneDocument"("status", "uploadedAt");
CREATE INDEX "TatoueurHygieneDocument_salonId_idx" ON "TatoueurHygieneDocument"("salonId");
CREATE UNIQUE INDEX "FavoriteFlash_clientId_flashId_key" ON "FavoriteFlash"("clientId", "flashId");
CREATE INDEX "FavoriteFlash_flashId_idx" ON "FavoriteFlash"("flashId");
CREATE UNIQUE INDEX "MoodboardFavorite_professionalId_moodboardId_key" ON "MoodboardFavorite"("professionalId", "moodboardId");
CREATE INDEX "MoodboardFavorite_moodboardId_idx" ON "MoodboardFavorite"("moodboardId");

-- AddForeignKey
ALTER TABLE "TatoueurHygieneDocument" ADD CONSTRAINT "TatoueurHygieneDocument_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteFlash" ADD CONSTRAINT "FavoriteFlash_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteFlash" ADD CONSTRAINT "FavoriteFlash_flashId_fkey" FOREIGN KEY ("flashId") REFERENCES "Flash"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MoodboardFavorite" ADD CONSTRAINT "MoodboardFavorite_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MoodboardFavorite" ADD CONSTRAINT "MoodboardFavorite_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
