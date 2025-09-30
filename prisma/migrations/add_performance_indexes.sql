-- Optimisation des performances : Index pour les queries du dashboard et recherches fréquentes

-- =====================================
-- INDEX POUR APPOINTMENTS (DASHBOARD)
-- =====================================

-- Index composite pour les statistiques dashboard par salon et date
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_appointment_userId_start_status" 
ON "Appointment" ("userId", "start", "status");

-- Index pour les requêtes de plage de dates (getAppointmentsByDateRange)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_appointment_start_end" 
ON "Appointment" ("start", "end");

-- Index pour les appointments payés par mois (getTotalPaidAppointmentsByMonth)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_appointment_userId_isPayed_start" 
ON "Appointment" ("userId", "isPayed", "start");

-- Index pour le statut des appointments (annulations, confirmations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_appointment_status_userId" 
ON "Appointment" ("status", "userId");

-- Index pour les appointments par tatoueur et date
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_appointment_tatoueurId_start" 
ON "Appointment" ("tatoueurId", "start");

-- =====================================
-- INDEX POUR CLIENTS (RECHERCHE)
-- =====================================

-- Index pour la recherche par email
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_client_email_gin" 
ON "Client" USING gin (to_tsvector('french', "email"));

-- Index pour la recherche par nom complet (tri)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_client_userId_lastName_firstName" 
ON "Client" ("userId", "lastName", "firstName");

-- Index pour la recherche par téléphone
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_client_phone" 
ON "Client" ("phone");

-- =====================================
-- INDEX POUR USERS (SALONS)
-- =====================================

-- Index pour la recherche par ville (géolocalisation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_city" 
ON "User" ("city");

-- Index pour la recherche par nom de salon
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_salonName_gin" 
ON "User" USING gin (to_tsvector('french', "salonName"));

-- Index pour les plans SaaS actifs
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_saasPlan_saasPlanUntil" 
ON "User" ("saasPlan", "saasPlanUntil");

-- =====================================
-- INDEX POUR TATOUEURS
-- =====================================

-- Index pour les tatoueurs par salon
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_tatoueur_userId_isEnabled" 
ON "Tatoueur" ("userId", "isEnabled");

-- Index pour la recherche par nom de tatoueur
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_tatoueur_name_gin" 
ON "Tatoueur" USING gin (to_tsvector('french', "name"));

-- =====================================
-- INDEX POUR TIME_SLOTS
-- =====================================

-- Index pour les créneaux horaires par salon et date
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_timeslot_userId_date" 
ON "TimeSlot" ("userId", "date");

-- Index pour les créneaux par tatoueur et disponibilité
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_timeslot_tatoueurId_isAvailable" 
ON "TimeSlot" ("tatoueurId", "isAvailable");

-- =====================================
-- INDEX POUR PORTFOLIO
-- =====================================

-- Index pour le portfolio par salon
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_portfolio_userId_createdAt" 
ON "Portfolio" ("userId", "createdAt" DESC);

-- =====================================
-- INDEX POUR PRODUCT_SALON
-- =====================================

-- Index pour les produits par salon
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_productsalon_userId_name" 
ON "ProductSalon" ("userId", "name");

-- =====================================
-- OPTIMISATIONS ADDITIONNELLES
-- =====================================

-- Statistiques automatiques pour le query planner
ANALYZE "Appointment";
ANALYZE "Client";
ANALYZE "User";
ANALYZE "Tatoueur";

-- =====================================
-- COMMENTAIRES D'EXPLICATION
-- =====================================

-- Ces index améliorent les performances pour :
-- 1. Dashboard: statistiques par salon, taux de remplissage, revenus mensuels
-- 2. Recherche: clients par nom/email, salons par ville/nom
-- 3. Planning: créneaux disponibles, appointments par tatoueur
-- 4. Filtrage: statuts des RDV, plans SaaS actifs
-- 5. Full-text search: recherche textuelle optimisée pour le français

-- L'option CONCURRENTLY évite le verrouillage des tables pendant la création
-- Les index GIN sont optimisés pour la recherche full-text en français
-- Les index composites respectent l'ordre des queries les plus fréquentes