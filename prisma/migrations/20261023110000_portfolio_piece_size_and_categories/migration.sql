-- Rename size enum/column (previously mislabeled as category)
ALTER TYPE "PortfolioCategory" RENAME TO "PieceSize";
ALTER TABLE "Portfolio" RENAME COLUMN "category" TO "pieceSize";

-- CreateTable
CREATE TABLE "TattooCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TattooCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PortfolioToTattooCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PortfolioToTattooCategory_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "TattooCategory_slug_key" ON "TattooCategory"("slug");

-- CreateIndex
CREATE INDEX "_PortfolioToTattooCategory_B_index" ON "_PortfolioToTattooCategory"("B");

-- AddForeignKey
ALTER TABLE "_PortfolioToTattooCategory" ADD CONSTRAINT "_PortfolioToTattooCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PortfolioToTattooCategory" ADD CONSTRAINT "_PortfolioToTattooCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "TattooCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Initial categories
INSERT INTO "TattooCategory" ("id", "slug", "name", "sortOrder") VALUES
  ('cat_walk_ins', 'walk-ins', 'Walk-ins', 1),
  ('cat_patchwork', 'patchwork', 'Patchwork', 2),
  ('cat_touriste', 'touriste', 'Touriste', 3);
