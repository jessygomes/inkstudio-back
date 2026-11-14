-- Suivi de cicatrisation : état de la cicatrisation (distinct de la note), jusqu'à 3 photos, canal et date de la réponse du salon.
ALTER TABLE "FollowUpSubmission" ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "FollowUpSubmission" ADD COLUMN "healingStatus" TEXT;
ALTER TABLE "FollowUpSubmission" ADD COLUMN "respondedAt" TIMESTAMP(3);
ALTER TABLE "FollowUpSubmission" ADD COLUMN "responseChannels" TEXT;
-- Les suivis existants gardent leur photo unique dans la liste.
UPDATE "FollowUpSubmission" SET "photoUrls" = ARRAY["photoUrl"] WHERE "photoUrl" IS NOT NULL AND "photoUrl" <> '';
