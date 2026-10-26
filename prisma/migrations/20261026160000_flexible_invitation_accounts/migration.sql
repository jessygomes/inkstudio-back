BEGIN;
ALTER TABLE "SubscriptionInvitation" ALTER COLUMN "role" DROP NOT NULL, ALTER COLUMN "plan" DROP NOT NULL;
ALTER TABLE "SubscriptionInvitationRedemption" ADD COLUMN "plan" "SaasPlan";
UPDATE "SubscriptionInvitationRedemption" r SET "plan" = i."plan"
  FROM "SubscriptionInvitation" i WHERE r."invitationId" = i."id";
ALTER TABLE "SubscriptionInvitationRedemption" ALTER COLUMN "plan" SET NOT NULL;
COMMIT;
