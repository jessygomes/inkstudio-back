
ALTER TABLE "User"
  ADD COLUMN "followUpDeliveryChannel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "retouchDeliveryChannel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "followUpMessage" TEXT,
  ADD COLUMN "retouchMessage" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_followUpDeliveryChannel_check" CHECK ("followUpDeliveryChannel" IN ('EMAIL', 'INKERA', 'BOTH'));
ALTER TABLE "User" ADD CONSTRAINT "User_retouchDeliveryChannel_check" CHECK ("retouchDeliveryChannel" IN ('EMAIL', 'INKERA', 'BOTH'));
ALTER TABLE "Appointment" ADD COLUMN "completedAt" TIMESTAMP(3);
UPDATE "Appointment" SET "completedAt" = "end" WHERE "status" = 'COMPLETED';
UPDATE "Appointment" a SET "followUp7SentAt" = r."sentAt" FROM "FollowUpRequest" r WHERE r."appointmentId" = a."id" AND r."sentAt" IS NOT NULL AND a."followUp7SentAt" IS NULL;
CREATE TABLE "AppointmentReminderDelivery" (
  "id" TEXT NOT NULL, "appointmentId" TEXT NOT NULL, "kind" TEXT NOT NULL, "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "claimedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentReminderDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentReminderDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppointmentReminderDelivery_kind_check" CHECK ("kind" IN ('FOLLOW_UP', 'RETOUCH')),
  CONSTRAINT "AppointmentReminderDelivery_channel_check" CHECK ("channel" IN ('EMAIL', 'INKERA')),
  CONSTRAINT "AppointmentReminderDelivery_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'SKIPPED'))
);
CREATE UNIQUE INDEX "AppointmentReminderDelivery_appointmentId_kind_channel_key" ON "AppointmentReminderDelivery"("appointmentId", "kind", "channel");
ALTER TABLE "NotificationPreference" ALTER COLUMN "emailFrequency" SET DEFAULT 'HOURLY';
UPDATE "NotificationPreference" SET "emailFrequency" = 'HOURLY' WHERE "emailFrequency" = 'IMMEDIATE';
