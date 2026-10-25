CREATE TABLE "ProjectProposalEmail" (
    "id" TEXT NOT NULL,
    "moodboardId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectProposalEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectProposalEmail_moodboardId_threshold_key" ON "ProjectProposalEmail"("moodboardId", "threshold");
CREATE INDEX "ProjectProposalEmail_status_nextAttemptAt_idx" ON "ProjectProposalEmail"("status", "nextAttemptAt");
ALTER TABLE "ProjectProposalEmail" ADD CONSTRAINT "ProjectProposalEmail_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
