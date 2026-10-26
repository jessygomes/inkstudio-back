BEGIN;
ALTER TABLE "SalonResidency" ADD COLUMN "presence" JSONB;
-- Preserve the days of the active timetable, without sharing its hours anymore.
UPDATE "SalonResidency" r SET "presence" = jsonb_build_object('type', 'recurring', 'days', days.value)
FROM (
 SELECT "id", jsonb_agg(DISTINCT (slot->>'day')::integer) AS value
 FROM "SalonResidency", jsonb_array_elements("schedule") AS slot
 WHERE jsonb_array_length("schedule") > 0 GROUP BY "id"
) days WHERE r."id" = days."id";
ALTER TABLE "User" ADD COLUMN "currentResidencyId" TEXT, ADD COLUMN "currentResidencyUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_currentResidencyId_fkey" FOREIGN KEY ("currentResidencyId") REFERENCES "SalonResidency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
