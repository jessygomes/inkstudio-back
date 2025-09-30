/*
  Warnings:

  - Ajout des index de performance pour optimiser les requêtes du dashboard et les recherches

*/

-- Index composites pour les statistiques dashboard
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_start_status" ON "Appointment" ("userId", "start", "status");
CREATE INDEX IF NOT EXISTS "idx_appointment_start_end" ON "Appointment" ("start", "end");
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_isPayed_start" ON "Appointment" ("userId", "isPayed", "start");
CREATE INDEX IF NOT EXISTS "idx_appointment_status_userId" ON "Appointment" ("status", "userId");
CREATE INDEX IF NOT EXISTS "idx_appointment_tatoueurId_start" ON "Appointment" ("tatoueurId", "start");

-- Index pour la recherche de clients
CREATE INDEX IF NOT EXISTS "idx_client_userId_lastName_firstName" ON "Client" ("userId", "lastName", "firstName");
CREATE INDEX IF NOT EXISTS "idx_client_phone" ON "Client" ("phone") WHERE "phone" IS NOT NULL;

-- Index pour les salons
CREATE INDEX IF NOT EXISTS "idx_user_city" ON "User" ("city") WHERE "city" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_user_saasPlan_saasPlanUntil" ON "User" ("saasPlan", "saasPlanUntil");

-- Index pour les tatoueurs
CREATE INDEX IF NOT EXISTS "idx_tatoueur_userId_isEnabled" ON "Tatoueur" ("userId", "isEnabled");

-- Index pour les créneaux horaires
CREATE INDEX IF NOT EXISTS "idx_timeslot_userId_date" ON "TimeSlot" ("userId", "date");
CREATE INDEX IF NOT EXISTS "idx_timeslot_tatoueurId_isAvailable" ON "TimeSlot" ("tatoueurId", "isAvailable");

-- Index pour le portfolio
CREATE INDEX IF NOT EXISTS "idx_portfolio_userId_createdAt" ON "Portfolio" ("userId", "createdAt" DESC);

-- Index pour les produits salon
CREATE INDEX IF NOT EXISTS "idx_productsalon_userId_name" ON "ProductSalon" ("userId", "name");