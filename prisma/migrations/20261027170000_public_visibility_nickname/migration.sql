CREATE TYPE "PublicVisibility" AS ENUM ('VISIBLE', 'SEARCH_HIDDEN', 'HIDDEN');
ALTER TABLE "User"
  ADD COLUMN "nickname" TEXT,
  ADD COLUMN "publicVisibility" "PublicVisibility" NOT NULL DEFAULT 'VISIBLE';
