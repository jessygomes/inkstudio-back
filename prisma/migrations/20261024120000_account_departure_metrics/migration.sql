CREATE TABLE "AccountDeparture" (
  "id" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'ADMIN_DELETION',
  CONSTRAINT "AccountDeparture_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccountDeparture_occurredAt_role_idx" ON "AccountDeparture"("occurredAt", "role");
CREATE TABLE "AdminMetricTracking" (
  "key" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminMetricTracking_pkey" PRIMARY KEY ("key")
);
INSERT INTO "AdminMetricTracking" ("key") VALUES ('account-departures');
