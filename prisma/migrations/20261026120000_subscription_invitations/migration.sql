CREATE TABLE "SubscriptionInvitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "plan" "SaasPlan" NOT NULL,
    "durationMonths" INTEGER NOT NULL DEFAULT 12,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedById" TEXT,
    CONSTRAINT "SubscriptionInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionInvitation_duration_check" CHECK ("durationMonths" BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "SubscriptionInvitation_tokenHash_key" ON "SubscriptionInvitation"("tokenHash");
CREATE UNIQUE INDEX "SubscriptionInvitation_redeemedById_key" ON "SubscriptionInvitation"("redeemedById");
CREATE INDEX "SubscriptionInvitation_createdAt_idx" ON "SubscriptionInvitation"("createdAt");
ALTER TABLE "SubscriptionInvitation" ADD CONSTRAINT "SubscriptionInvitation_redeemedById_fkey"
  FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
