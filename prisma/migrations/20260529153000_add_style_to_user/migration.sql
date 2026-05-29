-- Ajouter les styles directement sur le profil User (salon ou tatoueur independant)
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "style" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- S'assurer que les lignes existantes ont une valeur non nulle
UPDATE "User"
SET "style" = ARRAY[]::TEXT[]
WHERE "style" IS NULL;
