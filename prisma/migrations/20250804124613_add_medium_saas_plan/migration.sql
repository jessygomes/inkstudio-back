-- AlterEnum
ALTER TYPE "SaasPlan" ADD VALUE 'MEDIUM';

-- AlterTable
ALTER TABLE "SaasPlanDetails" ALTER COLUMN "maxAppointments" SET DEFAULT 30,
ALTER COLUMN "maxClients" SET DEFAULT 50,
ALTER COLUMN "maxTattooeurs" SET DEFAULT 1,
ALTER COLUMN "maxPortfolioImages" SET DEFAULT 5;
