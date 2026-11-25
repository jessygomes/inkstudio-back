-- Pseudo client unique sur toute la plateforme, sans tenir compte des majuscules.
-- 1. Les pseudos vides ou faits d'espaces deviennent NULL (aucun pseudo), les autres sont débarrassés des espaces autour.
UPDATE "ClientProfile" SET "pseudo" = NULL WHERE "pseudo" IS NOT NULL AND btrim("pseudo") = '';
UPDATE "ClientProfile" SET "pseudo" = btrim("pseudo") WHERE "pseudo" IS NOT NULL AND "pseudo" <> btrim("pseudo");

-- 2. Doublons déjà présents (même pseudo, majuscules ignorées) : le plus ancien profil garde son pseudo,
--    les suivants reçoivent un suffixe tiré de leur identifiant (ex. « inkfan-a1b2c3 »), modifiable ensuite dans le profil.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY lower("pseudo") ORDER BY "createdAt", "id") AS rn
  FROM "ClientProfile"
  WHERE "pseudo" IS NOT NULL
)
UPDATE "ClientProfile" p
SET "pseudo" = left(p."pseudo", 23) || '-' || right(p."id", 6)
FROM ranked r
WHERE p."id" = r."id" AND r.rn > 1;

-- 3. Unicité garantie par la base (inscriptions simultanées). Index sur une expression : non décrit dans schema.prisma.
CREATE UNIQUE INDEX "ClientProfile_pseudo_lower_key" ON "ClientProfile" (lower("pseudo"));
