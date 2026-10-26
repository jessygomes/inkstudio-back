BEGIN;
ALTER TABLE "SubscriptionInvitation" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "SubscriptionInvitation"
  ADD COLUMN "maxUses" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SubscriptionInvitationRedemption" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "userId" TEXT,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durationMonths" INTEGER NOT NULL,
  CONSTRAINT "SubscriptionInvitationRedemption_pkey" PRIMARY KEY ("id")
);

-- Preserve the usage and badges of invitations issued before shared links.
UPDATE "SubscriptionInvitation" SET "useCount" = 1 WHERE "redeemedAt" IS NOT NULL;
INSERT INTO "SubscriptionInvitationRedemption" ("id", "invitationId", "userId", "redeemedAt", "durationMonths")
  SELECT 'legacy_' || "id", "id", "redeemedById", "redeemedAt", "durationMonths"
  FROM "SubscriptionInvitation" WHERE "redeemedAt" IS NOT NULL;

ALTER TABLE "SubscriptionInvitation" DROP CONSTRAINT "SubscriptionInvitation_redeemedById_fkey";
DROP INDEX "SubscriptionInvitation_redeemedById_key";
ALTER TABLE "SubscriptionInvitation" DROP COLUMN "redeemedAt", DROP COLUMN "redeemedById";
ALTER TABLE "SubscriptionInvitation" ADD CONSTRAINT "SubscriptionInvitation_usage_check"
  CHECK ("maxUses" BETWEEN 1 AND 1000 AND "useCount" BETWEEN 0 AND "maxUses" AND ("email" IS NULL OR "maxUses" = 1));
CREATE UNIQUE INDEX "SubscriptionInvitationRedemption_userId_key" ON "SubscriptionInvitationRedemption"("userId");
CREATE INDEX "SubscriptionInvitationRedemption_invitationId_idx" ON "SubscriptionInvitationRedemption"("invitationId");
ALTER TABLE "SubscriptionInvitationRedemption" ADD CONSTRAINT "SubscriptionInvitationRedemption_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "SubscriptionInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionInvitationRedemption" ADD CONSTRAINT "SubscriptionInvitationRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
