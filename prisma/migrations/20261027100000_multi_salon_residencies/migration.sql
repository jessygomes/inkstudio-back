BEGIN;
CREATE TABLE "SalonResidency" (
 "id" TEXT NOT NULL PRIMARY KEY, "salonId" TEXT NOT NULL, "artistId" TEXT NOT NULL,
 "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3),
 "salonAllowsArtistCreate" BOOLEAN NOT NULL DEFAULT false,
 "salonAllowsArtistManage" BOOLEAN NOT NULL DEFAULT false,
 "salonAllowsPublicBooking" BOOLEAN NOT NULL DEFAULT false,
 "artistAllowsSalonView" BOOLEAN NOT NULL DEFAULT false,
 "artistAllowsSalonCreate" BOOLEAN NOT NULL DEFAULT false,
 "artistAllowsSalonManage" BOOLEAN NOT NULL DEFAULT false,
 "artistAllowsPublicBooking" BOOLEAN NOT NULL DEFAULT false,
 "schedule" JSONB NOT NULL DEFAULT '[]', "pendingSchedule" JSONB,
 "salonApproved" BOOLEAN NOT NULL DEFAULT false, "artistApproved" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SalonResidency_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SalonResidency_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalonResidency_salonId_artistId_key" ON "SalonResidency"("salonId", "artistId");
CREATE INDEX "SalonResidency_artistId_endedAt_idx" ON "SalonResidency"("artistId", "endedAt");
-- Keep accepted connections; do not copy a different salon's permissions to historical links.
INSERT INTO "SalonResidency" ("id", "salonId", "artistId", "joinedAt", "salonAllowsArtistCreate", "salonAllowsArtistManage", "salonAllowsPublicBooking", "artistAllowsSalonView", "artistAllowsSalonCreate", "artistAllowsPublicBooking")
SELECT 'res_' || md5(x."salonId" || ':' || x."artistId"), x."salonId", x."artistId", min(x."joinedAt"),
 bool_or(u."salonId" IS NOT DISTINCT FROM x."salonId"), bool_or(u."salonId" IS NOT DISTINCT FROM x."salonId"), bool_or(u."salonId" IS NOT DISTINCT FROM x."salonId" AND u."appointmentBookingEnabled"),
 bool_or(u."salonId" IS NOT DISTINCT FROM x."salonId" AND u."salonCanViewAppointments"), bool_or(u."salonId" IS NOT DISTINCT FROM x."salonId" AND u."salonCanCreateAppointments"), bool_or(u."salonId" IS NOT DISTINCT FROM x."salonId")
FROM (
 SELECT "salonId", "tatoueurUserId" AS "artistId", COALESCE("respondedAt", "createdAt") AS "joinedAt" FROM "SalonTatoueurTeamRequest" WHERE "status" = 'ACCEPTED'
 UNION ALL SELECT "salonId", "id", "createdAt" FROM "User" WHERE "role" = 'user_tatoueur' AND "salonId" IS NOT NULL
) x JOIN "User" u ON u."id" = x."artistId" JOIN "User" s ON s."id" = x."salonId"
WHERE u."role" = 'user_tatoueur' AND s."role" IN ('user_salon', 'user') AND s."id" <> u."id"
GROUP BY x."salonId", x."artistId";
ALTER TABLE "SalonTatoueurTeamRequest" ADD COLUMN "initiatedById" TEXT;
UPDATE "SalonTatoueurTeamRequest" SET "initiatedById" = "salonId";
DROP INDEX "SalonTatoueurTeamRequest_salonId_tatoueurUserId_status_key";
CREATE INDEX "SalonTatoueurTeamRequest_salonId_tatoueurUserId_status_idx" ON "SalonTatoueurTeamRequest"("salonId", "tatoueurUserId", "status");
CREATE UNIQUE INDEX "SalonTatoueurTeamRequest_one_pending" ON "SalonTatoueurTeamRequest"("salonId", "tatoueurUserId") WHERE "status" = 'PENDING';
ALTER TABLE "Appointment" ADD COLUMN "venueSalonId" TEXT, ADD COLUMN "venueName" TEXT, ADD COLUMN "venueAddress" TEXT, ADD COLUMN "venueCity" TEXT, ADD COLUMN "venuePostalCode" TEXT;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_venueSalonId_fkey" FOREIGN KEY ("venueSalonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Appointment_venueSalonId_start_idx" ON "Appointment"("venueSalonId", "start");
-- An old independent booking's historical salon cannot reliably be inferred from today's link.
UPDATE "Appointment" a SET "venueSalonId" = CASE WHEN u."role" IN ('user_salon', 'user') THEN u."id" ELSE NULL END,
 "venueName" = u."salonName", "venueAddress" = u."address", "venueCity" = u."city", "venuePostalCode" = u."postalCode"
FROM "User" u WHERE u."id" = a."userId";
COMMIT;
