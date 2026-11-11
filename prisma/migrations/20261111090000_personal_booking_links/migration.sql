-- CreateEnum
CREATE TYPE "DesiredTattooPeriod" AS ENUM ('ASAP', 'EXACT_DATE', 'DATE_RANGE', 'FLEXIBLE', 'UNDECIDED');

-- CreateEnum
CREATE TYPE "BookingLinkMode" AS ENUM ('FIXED_START', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "BookingLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "desiredTattooDate" DATE,
ADD COLUMN     "desiredTattooEndDate" DATE,
ADD COLUMN     "desiredTattooPeriod" "DesiredTattooPeriod",
ADD COLUMN     "desiredTattooStartDate" DATE;

-- CreateTable
CREATE TABLE "BookingLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tatoueurId" TEXT,
    "performerUserId" TEXT,
    "venueSalonId" TEXT,
    "prestation" "PrestationType" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "mode" "BookingLinkMode" NOT NULL,
    "fixedStartTime" TEXT,
    "allowedFrom" DATE NOT NULL,
    "allowedTo" DATE NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" "BookingLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "clientId" TEXT,
    "clientUserId" TEXT,
    "projectAppointmentId" TEXT,
    "conversationId" TEXT,
    "inboxThreadId" TEXT,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BookingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_tokenHash_key" ON "BookingLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_appointmentId_key" ON "BookingLink"("appointmentId");

-- CreateIndex
CREATE INDEX "BookingLink_userId_createdAt_idx" ON "BookingLink"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingLink_performerUserId_createdAt_idx" ON "BookingLink"("performerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingLink_venueSalonId_createdAt_idx" ON "BookingLink"("venueSalonId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingLink_status_expiresAt_idx" ON "BookingLink"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_performerUserId_fkey" FOREIGN KEY ("performerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_venueSalonId_fkey" FOREIGN KEY ("venueSalonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_projectAppointmentId_fkey" FOREIGN KEY ("projectAppointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_inboxThreadId_fkey" FOREIGN KEY ("inboxThreadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep preference dates consistent while preserving every legacy NULL preference.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_desired_tattoo_period_check" CHECK (
  ("desiredTattooPeriod" IS NULL AND "desiredTattooDate" IS NULL AND "desiredTattooStartDate" IS NULL AND "desiredTattooEndDate" IS NULL)
  OR (prestation = 'PROJET' AND "desiredTattooPeriod" IS NOT NULL AND (
    ("desiredTattooPeriod" IN ('ASAP','FLEXIBLE','UNDECIDED') AND "desiredTattooDate" IS NULL AND "desiredTattooStartDate" IS NULL AND "desiredTattooEndDate" IS NULL)
    OR ("desiredTattooPeriod" = 'EXACT_DATE' AND "desiredTattooDate" IS NOT NULL AND "desiredTattooStartDate" IS NULL AND "desiredTattooEndDate" IS NULL)
    OR ("desiredTattooPeriod" = 'DATE_RANGE' AND "desiredTattooDate" IS NULL AND "desiredTattooStartDate" IS NOT NULL AND "desiredTattooEndDate" IS NOT NULL AND "desiredTattooStartDate" <= "desiredTattooEndDate")
  ))
);
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_parameters_check" CHECK (
  prestation IN ('TATTOO','RETOUCHE') AND "durationMinutes" BETWEEN 1 AND 1440
  AND "allowedFrom" <= "allowedTo" AND "allowedTo" - "allowedFrom" <= 365
  AND (("tatoueurId" IS NOT NULL)::int + ("performerUserId" IS NOT NULL)::int = 1)
  AND ((mode = 'AUTOMATIC' AND "fixedStartTime" IS NULL) OR (mode = 'FIXED_START' AND "fixedStartTime" IS NOT NULL AND "fixedStartTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
  AND (status <> 'USED' OR "usedAt" IS NOT NULL)
);
