import { ForbiddenException } from '@nestjs/common';
import { SaasPlan, SaasPlanStatus } from '@prisma/client';

interface PlanLookup {
  user: {
    findUnique: (args: any) => Promise<any>;
  };
}

/**
 * Un professionnel en plan FREE (ou abonnement expiré/résilié) garde l'accès à ses
 * conversations en lecture, mais ne peut plus y répondre et ne reçoit plus de messages.
 */
export async function isProfessionalPlanRestricted(prisma: PlanLookup, professionalUserId: string): Promise<boolean> {
  const professional = await prisma.user.findUnique({
    where: { id: professionalUserId },
    select: {
      role: true,
      saasPlan: true,
      saasPlanUntil: true,
      saasPlanDetails: { select: { currentPlan: true, planStatus: true, endDate: true } },
    },
  });
  if (!professional || professional.role === 'client' || professional.role === 'admin') return false;

  const now = new Date();
  const details = professional.saasPlanDetails;
  return (
    professional.saasPlan === SaasPlan.FREE ||
    (professional.saasPlanUntil !== null && professional.saasPlanUntil < now) ||
    (!!details &&
      (details.currentPlan === SaasPlan.FREE ||
        details.planStatus === SaasPlanStatus.EXPIRED ||
        details.planStatus === SaasPlanStatus.CANCELED ||
        (details.endDate !== null && details.endDate < now)))
  );
}

export async function assertProfessionalCanMessage(prisma: PlanLookup, professionalUserId: string): Promise<void> {
  if (await isProfessionalPlanRestricted(prisma, professionalUserId)) {
    throw new ForbiddenException(
      'La messagerie est réservée aux professionnels abonnés : cette conversation est en lecture seule.',
    );
  }
}

export async function assertProfessionalCanCreateClient(prisma: PlanLookup, professionalUserId: string): Promise<void> {
  if (await isProfessionalPlanRestricted(prisma, professionalUserId)) {
    throw new ForbiddenException('Le plan FREE ne permet pas de créer des fiches clients. Passez au plan PRO ou BUSINESS.');
  }
}
