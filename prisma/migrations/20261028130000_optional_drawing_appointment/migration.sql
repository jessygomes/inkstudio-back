ALTER TABLE "DrawingCard" DROP CONSTRAINT "DrawingCard_sourceAppointmentId_fkey";
ALTER TABLE "DrawingCard" ALTER COLUMN "sourceAppointmentId" DROP NOT NULL;
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_sourceAppointmentId_fkey"
FOREIGN KEY ("sourceAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
