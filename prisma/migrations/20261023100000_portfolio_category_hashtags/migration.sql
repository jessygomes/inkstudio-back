-- CreateEnum
CREATE TYPE "PortfolioCategory" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN "category" "PortfolioCategory",
ADD COLUMN "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];
