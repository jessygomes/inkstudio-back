-- Concours promotionnels (module giveaways). Migration uniquement additive : aucune table ni colonne existante n'est modifiee.
-- CreateEnum
CREATE TYPE "GiveawayStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'DRAWN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GiveawayEntryStatus" AS ENUM ('VALID', 'PENDING_REVIEW', 'INVALID', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "GiveawayPrizeType" AS ENUM ('SUBSCRIPTION_GRANT');

-- CreateEnum
CREATE TYPE "GiveawayDrawStatus" AS ENUM ('OFFICIAL', 'VOIDED');

-- CreateEnum
CREATE TYPE "GiveawayDrawRole" AS ENUM ('WINNER', 'ALTERNATE');

-- CreateEnum
CREATE TYPE "GiveawayAwardStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'ACCEPTED', 'DECLINED', 'FORFEITED', 'ACTIVATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionGrantMode" AS ENUM ('APP_ENTITLEMENT', 'STRIPE_TRIAL_EXTENSION');

-- CreateEnum
CREATE TYPE "SubscriptionGrantStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "Giveaway" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "GiveawayStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "frozenById" TEXT,
    "resultsPublishedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "rulesUrl" TEXT,
    "rulesContent" TEXT,
    "rulesHash" TEXT,
    "rulesApprovedAt" TIMESTAMP(3),
    "rulesApprovedById" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "personalDataPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayCategory" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB NOT NULL,
    "winnersCount" INTEGER NOT NULL,
    "alternatesCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawayCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayPrize" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "type" "GiveawayPrizeType" NOT NULL,
    "label" TEXT NOT NULL,
    "plan" "SaasPlan",
    "durationMonths" INTEGER,
    "quantity" INTEGER NOT NULL,
    "commercialValueCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawayPrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayEntry" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "userId" TEXT,
    "participantHash" TEXT NOT NULL,
    "status" "GiveawayEntryStatus" NOT NULL DEFAULT 'VALID',
    "invalidReason" TEXT,
    "acceptedRulesAt" TIMESTAMP(3) NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "rulesHash" TEXT,
    "eligibilityAtEntry" JSONB,
    "eligibilityAtClose" JSONB,
    "closeCheckedAt" TIMESTAMP(3),
    "identitySignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duplicateOfEntryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayDraw" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "status" "GiveawayDrawStatus" NOT NULL DEFAULT 'OFFICIAL',
    "officialKey" TEXT,
    "algorithm" TEXT NOT NULL,
    "seedHex" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "winnersCount" INTEGER NOT NULL,
    "alternatesCount" INTEGER NOT NULL,
    "executedById" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "supersedesId" TEXT,

    CONSTRAINT "GiveawayDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayDrawResult" (
    "id" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "role" "GiveawayDrawRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayDrawResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayAward" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "drawResultId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "GiveawayAwardStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "acceptDeadline" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "forfeitedAt" TIMESTAMP(3),
    "publicationConsent" BOOLEAN,
    "publicationConsentAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawayAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "awardId" TEXT,
    "source" TEXT NOT NULL,
    "plan" "SaasPlan" NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "mode" "SubscriptionGrantMode" NOT NULL,
    "status" "SubscriptionGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "previousPaymentMethod" TEXT,
    "previousPlan" "SaasPlan",
    "previousEndDate" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "stripeRequestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayAuditLog" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayEmailDelivery" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawayEmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Giveaway_slug_key" ON "Giveaway"("slug");

-- CreateIndex
CREATE INDEX "Giveaway_status_opensAt_idx" ON "Giveaway"("status", "opensAt");

-- CreateIndex
CREATE INDEX "GiveawayCategory_giveawayId_sortOrder_idx" ON "GiveawayCategory"("giveawayId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayCategory_giveawayId_key_key" ON "GiveawayCategory"("giveawayId", "key");

-- CreateIndex
CREATE INDEX "GiveawayPrize_categoryId_idx" ON "GiveawayPrize"("categoryId");

-- CreateIndex
CREATE INDEX "GiveawayEntry_giveawayId_categoryId_status_idx" ON "GiveawayEntry"("giveawayId", "categoryId", "status");

-- CreateIndex
CREATE INDEX "GiveawayEntry_giveawayId_createdAt_idx" ON "GiveawayEntry"("giveawayId", "createdAt");

-- CreateIndex
CREATE INDEX "GiveawayEntry_identitySignals_idx" ON "GiveawayEntry" USING GIN ("identitySignals");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayEntry_giveawayId_userId_key" ON "GiveawayEntry"("giveawayId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayEntry_giveawayId_participantHash_key" ON "GiveawayEntry"("giveawayId", "participantHash");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDraw_officialKey_key" ON "GiveawayDraw"("officialKey");

-- CreateIndex
CREATE INDEX "GiveawayDraw_giveawayId_categoryId_idx" ON "GiveawayDraw"("giveawayId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDrawResult_drawId_rank_key" ON "GiveawayDrawResult"("drawId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDrawResult_drawId_entryId_key" ON "GiveawayDrawResult"("drawId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayAward_drawResultId_key" ON "GiveawayAward"("drawResultId");

-- CreateIndex
CREATE INDEX "GiveawayAward_giveawayId_status_idx" ON "GiveawayAward"("giveawayId", "status");

-- CreateIndex
CREATE INDEX "GiveawayAward_userId_idx" ON "GiveawayAward"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionGrant_awardId_key" ON "SubscriptionGrant"("awardId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionGrant_idempotencyKey_key" ON "SubscriptionGrant"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SubscriptionGrant_userId_status_idx" ON "SubscriptionGrant"("userId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionGrant_endsAt_idx" ON "SubscriptionGrant"("endsAt");

-- CreateIndex
CREATE INDEX "GiveawayAuditLog_giveawayId_createdAt_idx" ON "GiveawayAuditLog"("giveawayId", "createdAt");

-- CreateIndex
CREATE INDEX "GiveawayAuditLog_action_idx" ON "GiveawayAuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayEmailDelivery_key_key" ON "GiveawayEmailDelivery"("key");

-- CreateIndex
CREATE INDEX "GiveawayEmailDelivery_kind_status_idx" ON "GiveawayEmailDelivery"("kind", "status");

-- AddForeignKey
ALTER TABLE "GiveawayCategory" ADD CONSTRAINT "GiveawayCategory_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayPrize" ADD CONSTRAINT "GiveawayPrize_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayPrize" ADD CONSTRAINT "GiveawayPrize_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GiveawayCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GiveawayCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayDraw" ADD CONSTRAINT "GiveawayDraw_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayDraw" ADD CONSTRAINT "GiveawayDraw_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GiveawayCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayDrawResult" ADD CONSTRAINT "GiveawayDrawResult_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "GiveawayDraw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayDrawResult" ADD CONSTRAINT "GiveawayDrawResult_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "GiveawayEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAward" ADD CONSTRAINT "GiveawayAward_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAward" ADD CONSTRAINT "GiveawayAward_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GiveawayCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAward" ADD CONSTRAINT "GiveawayAward_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "GiveawayPrize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAward" ADD CONSTRAINT "GiveawayAward_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "GiveawayEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAward" ADD CONSTRAINT "GiveawayAward_drawResultId_fkey" FOREIGN KEY ("drawResultId") REFERENCES "GiveawayDrawResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAward" ADD CONSTRAINT "GiveawayAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "GiveawayAward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayAuditLog" ADD CONSTRAINT "GiveawayAuditLog_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

