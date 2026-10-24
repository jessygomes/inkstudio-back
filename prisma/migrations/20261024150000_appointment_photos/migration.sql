CREATE TABLE "AppointmentPhoto" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "caption" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AppointmentPhoto_appointmentId_createdAt_idx" ON "AppointmentPhoto"("appointmentId", "createdAt");
ALTER TABLE "AppointmentPhoto" ADD CONSTRAINT "AppointmentPhoto_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Portfolio" ADD COLUMN "appointmentPhotoId" TEXT;
CREATE UNIQUE INDEX "Portfolio_appointmentPhotoId_userId_key" ON "Portfolio"("appointmentPhotoId", "userId");
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_appointmentPhotoId_fkey" FOREIGN KEY ("appointmentPhotoId") REFERENCES "AppointmentPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
