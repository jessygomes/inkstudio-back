-- Migration: Séparation du rôle "user" en "user_salon" et "user_tatoueur"
-- Les utilisateurs existants avec le rôle "user" restent inchangés pour compatibilité.

-- 1. Ajouter les nouvelles valeurs à l'enum Role
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'user_salon';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'user_tatoueur';

-- 2. Ajouter la colonne salonId sur User (lien tatoueur → salon)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "salonId" TEXT;

-- 3. Ajouter la contrainte de clé étrangère
ALTER TABLE "User" ADD CONSTRAINT "User_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Créer l'index sur salonId pour les performances
CREATE INDEX IF NOT EXISTS "User_salonId_idx" ON "User"("salonId");
