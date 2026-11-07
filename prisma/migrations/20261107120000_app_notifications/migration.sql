-- Centre de notifications (dans l'app) et preferences par categorie.
CREATE TABLE "AppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppNotification_userId_dedupeKey_key" ON "AppNotification"("userId", "dedupeKey");
CREATE INDEX "AppNotification_userId_createdAt_idx" ON "AppNotification"("userId", "createdAt");
CREATE INDEX "AppNotification_userId_readAt_idx" ON "AppNotification"("userId", "readAt");
CREATE INDEX "AppNotification_createdAt_idx" ON "AppNotification"("createdAt");
ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationCategoryPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCategoryPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationCategoryPreference_userId_category_key" ON "NotificationCategoryPreference"("userId", "category");
CREATE INDEX "NotificationCategoryPreference_userId_idx" ON "NotificationCategoryPreference"("userId");
ALTER TABLE "NotificationCategoryPreference" ADD CONSTRAINT "NotificationCategoryPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
