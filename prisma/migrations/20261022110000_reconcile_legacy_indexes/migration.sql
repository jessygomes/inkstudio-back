-- Index historiques non couverts par Prisma Schema.
-- Cette migration fonctionne aussi bien sur une base vide après le baseline
-- que sur une base existante ayant reçu db push et certains index manuellement.
-- Toutes les colonnes ci-dessous existent dans le schéma Inkera pré-Inbox.

-- Rendez-vous : dashboard, dates, paiement et attribution.
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_start_status" ON "Appointment" ("userId", "start", "status");
CREATE INDEX IF NOT EXISTS "idx_appointment_start_end" ON "Appointment" ("start", "end");
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_isPayed_start" ON "Appointment" ("userId", "isPayed", "start");
CREATE INDEX IF NOT EXISTS "idx_appointment_status_userId" ON "Appointment" ("status", "userId");
CREATE INDEX IF NOT EXISTS "idx_appointment_tatoueurId_start" ON "Appointment" ("tatoueurId", "start");

-- Clients et utilisateurs. Conserver les deux index partiels déjà présents.
CREATE INDEX IF NOT EXISTS "idx_client_userId_lastName_firstName" ON "Client" ("userId", "lastName", "firstName");
CREATE INDEX IF NOT EXISTS "idx_client_phone" ON "Client" ("phone") WHERE "phone" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_user_city" ON "User" ("city") WHERE "city" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_user_saasPlan_saasPlanUntil" ON "User" ("saasPlan", "saasPlanUntil");

-- L'ancien fichier ciblait Tatoueur.isEnabled, qui n'existe plus.
-- Le champ actuel est Tatoueur.rdvBookingEnabled.
CREATE INDEX IF NOT EXISTS "idx_tatoueur_userId_rdvBookingEnabled" ON "Tatoueur" ("userId", "rdvBookingEnabled");

-- L'ancien index TimeSlot(tatoueurId, isAvailable) est volontairement omis :
-- TimeSlot.tatoueurId n'existe pas dans le schéma actuel.
CREATE INDEX IF NOT EXISTS "idx_timeslot_userId_date" ON "TimeSlot" ("userId", "date");

-- Portfolio et produits.
CREATE INDEX IF NOT EXISTS "idx_portfolio_userId_createdAt" ON "Portfolio" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_productsalon_userId_name" ON "ProductSalon" ("userId", "name");
