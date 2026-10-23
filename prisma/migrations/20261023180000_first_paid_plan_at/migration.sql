-- Pas de reprise depuis startDate/lastPaymentDate : ces dates ne permettent
-- pas de connaître le début du premier abonnement payant.
ALTER TABLE "SaasPlanDetails" ADD COLUMN "firstPaidPlanAt" TIMESTAMP(3);
