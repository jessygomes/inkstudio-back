-- AlterTable
ALTER TABLE "Moodboard" ADD COLUMN     "projectBodyPlacement" TEXT,
ADD COLUMN     "projectCategory" TEXT,
ADD COLUMN     "projectCity" TEXT,
ADD COLUMN     "projectHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "projectMobility" TEXT,
ADD COLUMN     "projectRadiusKm" INTEGER,
ADD COLUMN     "projectSize" TEXT,
ADD COLUMN     "projectStatus" TEXT NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "projectStyles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "projectContactPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectProposal" (
    "id" TEXT NOT NULL,
    "moodboardId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "conversationId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalBlock" (
    "id" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalReport" (
    "id" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "proposalId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectProposal_clientUserId_createdAt_idx" ON "ProjectProposal"("clientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectProposal_conversationId_idx" ON "ProjectProposal"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProposal_moodboardId_professionalId_key" ON "ProjectProposal"("moodboardId", "professionalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalBlock_clientUserId_professionalId_key" ON "ProfessionalBlock"("clientUserId", "professionalId");

-- CreateIndex
CREATE INDEX "ProfessionalReport_createdAt_idx" ON "ProfessionalReport"("createdAt");

-- CreateIndex
CREATE INDEX "Moodboard_projectStatus_publishedAt_idx" ON "Moodboard"("projectStatus", "publishedAt");

-- AddForeignKey
ALTER TABLE "ProjectProposal" ADD CONSTRAINT "ProjectProposal_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProposal" ADD CONSTRAINT "ProjectProposal_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProposal" ADD CONSTRAINT "ProjectProposal_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProposal" ADD CONSTRAINT "ProjectProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalBlock" ADD CONSTRAINT "ProfessionalBlock_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalBlock" ADD CONSTRAINT "ProfessionalBlock_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalReport" ADD CONSTRAINT "ProfessionalReport_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalReport" ADD CONSTRAINT "ProfessionalReport_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalReport" ADD CONSTRAINT "ProfessionalReport_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ProjectProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
