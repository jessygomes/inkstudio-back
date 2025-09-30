-- Optimisation des performances : Index pour les queries du dashboard et recherches fréquentes
-- Version adaptée pour exécution via Prisma (sans CONCURRENTLY)

-- =====================================
-- INDEX POUR APPOINTMENTS (DASHBOARD)
-- =====================================

-- Index composite pour les statistiques dashboard par salon et date
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_start_status" 
ON "Appointment" ("userId", "start", "status");

-- Index pour les requêtes de plage de dates (getAppointmentsByDateRange)
CREATE INDEX IF NOT EXISTS "idx_appointment_start_end" 
ON "Appointment" ("start", "end");

-- Index pour les appointments payés par mois (getTotalPaidAppointmentsByMonth)
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_isPayed_start" 
ON "Appointment" ("userId", "isPayed", "start");

-- Index pour le statut des appointments (annulations, confirmations)
CREATE INDEX IF NOT EXISTS "idx_appointment_status_userId" 
ON "Appointment" ("status", "userId");

-- Index pour les appointments par tatoueur et date
CREATE INDEX IF NOT EXISTS "idx_appointment_tatoueurId_start" 
ON "Appointment" ("tatoueurId", "start");

-- =====================================
-- INDEX POUR CLIENTS (RECHERCHE)
-- =====================================

-- Index pour la recherche par nom complet (tri)
CREATE INDEX IF NOT EXISTS "idx_client_userId_lastName_firstName" 
ON "Client" ("userId", "lastName", "firstName");

-- Index pour la recherche par téléphone
CREATE INDEX IF NOT EXISTS "idx_client_phone" 
ON "Client" ("phone") WHERE "phone" IS NOT NULL;

-- =====================================
-- INDEX POUR USERS (SALONS)
-- =====================================

-- Index pour la recherche par ville (géolocalisation)
CREATE INDEX IF NOT EXISTS "idx_user_city" 
ON "User" ("city") WHERE "city" IS NOT NULL;

-- Index pour les plans SaaS actifs
CREATE INDEX IF NOT EXISTS "idx_user_saasPlan_saasPlanUntil" 
ON "User" ("saasPlan", "saasPlanUntil");

-- =====================================
-- INDEX POUR TATOUEURS
-- =====================================

-- Index pour les tatoueurs par salon
CREATE INDEX IF NOT EXISTS "idx_tatoueur_userId_isEnabled" 
ON "Tatoueur" ("userId", "isEnabled");

-- =====================================
-- INDEX POUR TIME_SLOTS
-- =====================================

-- Index pour les créneaux horaires par salon et date
CREATE INDEX IF NOT EXISTS "idx_timeslot_userId_date" 
ON "TimeSlot" ("userId", "date");

-- Index pour les créneaux par tatoueur et disponibilité
CREATE INDEX IF NOT EXISTS "idx_timeslot_tatoueurId_isAvailable" 
ON "TimeSlot" ("tatoueurId", "isAvailable");

-- =====================================
-- INDEX POUR PORTFOLIO
-- =====================================

-- Index pour le portfolio par salon
CREATE INDEX IF NOT EXISTS "idx_portfolio_userId_createdAt" 
ON "Portfolio" ("userId", "createdAt" DESC);

-- =====================================
-- INDEX POUR PRODUCT_SALON
-- =====================================

-- Index pour les produits par salon
CREATE INDEX IF NOT EXISTS "idx_productsalon_userId_name" 
ON "ProductSalon" ("userId", "name");