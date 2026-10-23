-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Style_key_key" ON "Style"("key");

-- Seed from styles already used in portfolios (one row per normalized key)
INSERT INTO "Style" ("id", "name", "key")
SELECT DISTINCT ON (k.key) 'sty_' || md5(k.key), k.name, k.key
FROM (
    SELECT upper(btrim(s)) AS name,
           regexp_replace(
             lower(translate(btrim(s),
               'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
               'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
             '[^a-z0-9]', '', 'g') AS key
    FROM "Portfolio", unnest("style") AS s
) k
WHERE k.key <> ''
ORDER BY k.key, k.name;
