-- Optimisation des performances : Index adaptés au schéma réel de la base de données

-- =====================================
-- INDEX POUR APPOINTMENTS (DASHBOARD)
-- =====================================

-- Index composite pour les statistiques dashboard par salon et date
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_start_status" 
ON "Appointment" ("userId", "start", "status");

-- Index pour les requêtes de plage de dates
CREATE INDEX IF NOT EXISTS "idx_appointment_start_end" 
ON "Appointment" ("start", "end");

-- Index pour les appointments payés par mois
CREATE INDEX IF NOT EXISTS "idx_appointment_userId_isPayed_start" 
ON "Appointment" ("userId", "isPayed", "start");

-- Index pour le statut des appointments
CREATE INDEX IF NOT EXISTS "idx_appointment_status_userId" 
ON "Appointment" ("status", "userId");

-- Index pour les appointments par tatoueur et date
CREATE INDEX IF NOT EXISTS "idx_appointment_tatoueurId_start" 
ON "Appointment" ("tatoueurId", "start");

-- =====================================
-- INDEX POUR CLIENTS (RECHERCHE)
-- =====================================

-- Index pour la recherche par nom complet
CREATE INDEX IF NOT EXISTS "idx_client_userId_lastName_firstName" 
ON "Client" ("userId", "lastName", "firstName");

-- Index pour la recherche par téléphone (si la colonne existe)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Client' AND column_name = 'phone') THEN
        CREATE INDEX IF NOT EXISTS "idx_client_phone" ON "Client" ("phone") WHERE "phone" IS NOT NULL;
    END IF;
END $$;

-- =====================================
-- INDEX POUR USERS (SALONS)
-- =====================================

-- Index pour la recherche par ville
CREATE INDEX IF NOT EXISTS "idx_user_city" 
ON "User" ("city") WHERE "city" IS NOT NULL;

-- Index pour les plans SaaS actifs
CREATE INDEX IF NOT EXISTS "idx_user_saasPlan_saasPlanUntil" 
ON "User" ("saasPlan", "saasPlanUntil");

-- =====================================
-- INDEX POUR TATOUEURS
-- =====================================

-- Index pour les tatoueurs par salon et statut RDV
CREATE INDEX IF NOT EXISTS "idx_tatoueur_userId_rdvBookingEnabled" 
ON "Tatoueur" ("userId", "rdvBookingEnabled");

-- =====================================
-- INDEX CONDITIONELS POUR TABLES EXISTANTES
-- =====================================

-- Index pour TimeSlot (si la table existe)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'TimeSlot') THEN
        CREATE INDEX IF NOT EXISTS "idx_timeslot_userId_date" ON "TimeSlot" ("userId", "date");
        
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'TimeSlot' AND column_name = 'tatoueurId') THEN
            CREATE INDEX IF NOT EXISTS "idx_timeslot_tatoueurId_isAvailable" ON "TimeSlot" ("tatoueurId", "isAvailable");
        END IF;
    END IF;
END $$;

-- Index pour Portfolio (si la table existe)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Portfolio') THEN
        CREATE INDEX IF NOT EXISTS "idx_portfolio_userId_createdAt" ON "Portfolio" ("userId", "createdAt" DESC);
    END IF;
END $$;

-- Index pour ProductSalon (si la table existe)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ProductSalon') THEN
        CREATE INDEX IF NOT EXISTS "idx_productsalon_userId_name" ON "ProductSalon" ("userId", "name");
    END IF;
END $$;