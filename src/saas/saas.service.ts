import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AgendaMode, SaasPlan, SaasPlanStatus } from '@prisma/client';
import { freePlan, proPlan, businessPlan } from '../../utils/data';
import { SaasGuardAction } from './saas-limit.decorator';

type UpdatePlanOptions = {
  planStatus?: SaasPlanStatus;
  trialEndDate?: Date | null;
  nextPaymentDate?: Date | null;
  lastPaymentDate?: Date | null;
  pastDueSince?: Date | null;
};

@Injectable()
export class SaasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   *! 🔍 RÉCUPÉRER LES DÉTAILS DU PLAN SAAS D'UN UTILISATEUR
   */
  async getUserPlanDetails(userId: string) {
    let planDetails = await this.prisma.saasPlanDetails.findUnique({
      where: { userId },
    });

    // Si pas de plan détaillé (cas exceptionnel, normalement créé à l'inscription)
    if (!planDetails) {
      console.warn(`Aucun plan trouvé pour l'utilisateur ${userId}, création d'un plan basé sur l'inscription`);
      planDetails = await this.createPlanFromUserChoice(userId);
    }

    // Vérifier si le plan est expiré
    if (planDetails.endDate && planDetails.endDate < new Date()) {
      planDetails = await this.expirePlan(userId);
    }

    // Retourner les détails du plan
    return planDetails;
  }

  async enforceSaasAccess(userId: string, action: SaasGuardAction) {
    if (action !== 'appointment' && action !== 'client' && action !== 'dashboard' && action !== 'stock') {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        saasPlan: true,
      },
    });

    if (!user) {
      throw new ForbiddenException('Utilisateur introuvable.');
    }

    const isRestrictedRole = user.role === 'user_salon' || user.role === 'user_tatoueur';
    const isFreePlan = user.saasPlan === SaasPlan.FREE;

    if (isRestrictedRole && isFreePlan) {
      const actionLabel =
        action === 'appointment'
          ? 'créer des rendez-vous'
          : action === 'client'
            ? 'créer des fiches clients'
            : action === 'stock'
              ? 'gérer le stock'
              : 'accéder aux statistiques du dashboard';

      throw new ForbiddenException(
        `Le plan FREE ne permet pas de ${actionLabel}. Passez au plan PRO ou BUSINESS.`,
      );
    }
  }

  /**
   * 🔧 VÉRIFIER SI UNE FONCTIONNALITÉ EST DISPONIBLE
   */
  async hasFeature(userId: string, feature: 'advancedStats' | 'emailReminders' | 'customBranding' | 'apiAccess'): Promise<boolean> {
    const planDetails = await this.getUserPlanDetails(userId);
    
    switch (feature) {
      case 'advancedStats':
        return planDetails.hasAdvancedStats;
      case 'emailReminders':
        return planDetails.hasEmailReminders;
      case 'customBranding':
        return planDetails.hasCustomBranding;
      case 'apiAccess':
        return planDetails.hasApiAccess;
      default:
        return false;
    }
  }

  /**
   * 🏗️ CRÉER UN PLAN BASÉ SUR LE CHOIX DE L'UTILISATEUR LORS DE L'INSCRIPTION
   */
  private async createPlanFromUserChoice(userId: string) {
    // Récupérer le plan choisi par l'utilisateur lors de l'inscription
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { saasPlan: true },
    });

    // Si pas d'utilisateur trouvé, créer un plan FREE par défaut
    if (!user) {
      return await this.createDefaultPlan(userId, SaasPlan.FREE);
    }

    // Créer le plan détaillé basé sur le choix de l'utilisateur
    return await this.createDefaultPlan(userId, user.saasPlan);
  }

  /**
   * 🏗️ CRÉER UN PLAN PAR DÉFAUT
   */
  private async createDefaultPlan(userId: string, plan: SaasPlan = SaasPlan.FREE) {
    const planConfig = this.getPlanConfiguration(plan);
    
    // Calculer la date d'expiration : 1 an pour les plans payants, null pour FREE
    const endDate = plan !== SaasPlan.FREE 
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 an
      : null;
    
    return await this.prisma.saasPlanDetails.create({
      data: {
        userId,
        currentPlan: plan,
        planStatus: SaasPlanStatus.ACTIVE,
        endDate,
        ...planConfig,
      },
    });
  }

  /**
   * 🎯 CRÉER UN PLAN LORS DE L'INSCRIPTION
   */
  async createUserPlanOnRegistration(userId: string, plan: SaasPlan) {
    const planConfig = this.getPlanConfiguration(plan);
    
    // Calculer la date d'expiration : 1 an pour les plans payants, null pour FREE
    const endDate = plan !== SaasPlan.FREE 
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 an
      : null;
    
    return await this.prisma.saasPlanDetails.create({
      data: {
        userId,
        currentPlan: plan,
        planStatus: SaasPlanStatus.ACTIVE,
        endDate,
        ...planConfig,
      },
    });
  }

  /**
   * ⏰ FAIRE EXPIRER UN PLAN
   */
  private async expirePlan(userId: string) {
    const freeConfig = this.getPlanConfiguration(SaasPlan.FREE);
    
    return await this.prisma.saasPlanDetails.update({
      where: { userId },
      data: {
        planStatus: SaasPlanStatus.EXPIRED,
        currentPlan: SaasPlan.FREE,
        ...freeConfig,
      },
    });
  }

  /**
   * 🔄 METTRE À JOUR LE PLAN D'UN UTILISATEUR
   */
  async updateUserPlan(
    userId: string,
    plan: SaasPlan,
    endDate?: Date | null,
    options?: UpdatePlanOptions,
  ) {
    const planConfig = this.getPlanConfiguration(plan);

    const planStatus = options?.planStatus ?? SaasPlanStatus.ACTIVE;

    // Ces champs sont optionnels: on ne les écrit que lorsqu'ils sont fournis
    // explicitement, afin d'éviter d'écraser des dates déjà stockées.
    const optionalFields: Partial<{
      trialEndDate: Date | null;
      nextPaymentDate: Date | null;
      lastPaymentDate: Date | null;
      pastDueSince: Date | null;
    }> = {};

    if (options && 'trialEndDate' in options) {
      optionalFields.trialEndDate = options.trialEndDate ?? null;
    }

    if (options && 'nextPaymentDate' in options) {
      optionalFields.nextPaymentDate = options.nextPaymentDate ?? null;
    }

    if (options && 'lastPaymentDate' in options) {
      optionalFields.lastPaymentDate = options.lastPaymentDate ?? null;
    }

    if (options && 'pastDueSince' in options) {
      optionalFields.pastDueSince = options.pastDueSince ?? null;
    }
    
    // Si pas de date d'expiration fournie, calculer automatiquement
    if (endDate === undefined) {
      endDate = plan !== SaasPlan.FREE 
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 an
        : null;
    }
    
    // Utiliser une transaction pour maintenir la cohérence entre les deux tables
    const [, saasPlanDetails] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          saasPlan: plan,
          saasPlanUntil: endDate,
        },
      }),
      this.prisma.saasPlanDetails.upsert({
        where: { userId },
        update: {
          currentPlan: plan,
          planStatus,
          endDate,
          ...optionalFields,
          ...planConfig,
        },
        create: {
          userId,
          currentPlan: plan,
          planStatus,
          endDate,
          ...optionalFields,
          ...planConfig,
        },
      }),
    ]);

    return saasPlanDetails;
  }

  /**
   * Met l'abonnement en mode essai (TRIAL) avec une date de fin d'essai.
   */
  async markSubscriptionTrialing(
    userId: string,
    plan: SaasPlan,
    trialEndDate: Date | null,
  ) {
    return await this.updateUserPlan(userId, plan, null, {
      planStatus: SaasPlanStatus.TRIAL,
      trialEndDate,
      nextPaymentDate: trialEndDate,
      pastDueSince: null,
    });
  }

  /**
   * Marque l'abonnement comme actif après paiement réussi.
   */
  async markSubscriptionActive(
    userId: string,
    plan: SaasPlan,
    nextPaymentDate: Date | null,
  ) {
    return await this.updateUserPlan(userId, plan, null, {
      planStatus: SaasPlanStatus.ACTIVE,
      trialEndDate: null,
      nextPaymentDate,
      lastPaymentDate: new Date(),
      pastDueSince: null,
    });
  }

  /**
   * Marque l'abonnement en retard de paiement (PAST_DUE).
   * Aucune restriction fonctionnelle n'est appliquée à ce stade.
   */
  async markSubscriptionPastDue(
    userId: string,
    plan: SaasPlan,
    nextPaymentDate: Date | null,
    pastDueSince: Date = new Date(),
  ) {
    return await this.updateUserPlan(userId, plan, null, {
      planStatus: SaasPlanStatus.PAST_DUE,
      nextPaymentDate,
      pastDueSince,
    });
  }

  /**
   * Rétrograde automatiquement en FREE les comptes en PAST_DUE
   * depuis plus de `gracePeriodDays` jours.
   */
  async downgradeExpiredPastDueUsers(gracePeriodDays = 5) {
    const cutoffDate = new Date(Date.now() - gracePeriodDays * 24 * 60 * 60 * 1000);

    const pastDueUsers = await this.prisma.saasPlanDetails.findMany({
      where: {
        planStatus: SaasPlanStatus.PAST_DUE,
        currentPlan: {
          in: [SaasPlan.PRO, SaasPlan.BUSINESS],
        },
        pastDueSince: {
          lte: cutoffDate,
        },
      },
      select: {
        userId: true,
      },
    });

    let downgradedCount = 0;

    for (const entry of pastDueUsers) {
      await this.updateUserPlan(entry.userId, SaasPlan.FREE, null, {
        planStatus: SaasPlanStatus.EXPIRED,
        trialEndDate: null,
        nextPaymentDate: null,
        pastDueSince: null,
      });
      downgradedCount += 1;
    }

    return {
      scanned: pastDueUsers.length,
      downgraded: downgradedCount,
      gracePeriodDays,
      cutoffDate,
    };
  }

  /**
   * Rétrograde automatiquement en FREE les comptes en TRIAL arrivés à échéance
   * lorsqu'aucune souscription Stripe active n'est rattachée.
   */
  async downgradeExpiredTrialUsers() {
    const now = new Date();

    const expiredTrialUsers = await this.prisma.saasPlanDetails.findMany({
      where: {
        planStatus: SaasPlanStatus.TRIAL,
        currentPlan: {
          in: [SaasPlan.PRO, SaasPlan.BUSINESS],
        },
        trialEndDate: {
          lte: now,
        },
      },
      select: {
        userId: true,
        user: {
          select: {
            stripeSubscriptionId: true,
          },
        },
      },
    });

    let downgradedCount = 0;

    for (const entry of expiredTrialUsers) {
      // Si Stripe pilote déjà la souscription, on laisse les webhooks faire foi.
      if (entry.user?.stripeSubscriptionId) {
        continue;
      }

      await this.updateUserPlan(entry.userId, SaasPlan.FREE, null, {
        planStatus: SaasPlanStatus.EXPIRED,
        trialEndDate: null,
        nextPaymentDate: null,
        pastDueSince: null,
      });
      downgradedCount += 1;
    }

    return {
      scanned: expiredTrialUsers.length,
      downgraded: downgradedCount,
      checkedAt: now,
    };
  }

  /**
   * ⚙️ CONFIGURATION DES PLANS
   */
  private getPlanConfiguration(plan: SaasPlan) {
    switch (plan) {
      case SaasPlan.FREE:
        return {
          agendaMode: AgendaMode.GLOBAL,
          maxAppointments: -1,
          maxClients: -1,
          maxTattooeurs: -1,
          maxPortfolioImages: -1,
          hasAdvancedStats: false,
          hasEmailReminders: false,
          hasCustomBranding: false,
          hasApiAccess: false,
          monthlyPrice: freePlan, // 0
        };
      
      case SaasPlan.PRO:
        return {
          agendaMode: AgendaMode.GLOBAL,
          maxAppointments: -1,
          maxClients: -1,
          maxTattooeurs: -1,
          maxPortfolioImages: -1,
          hasAdvancedStats: true,
          hasEmailReminders: true,
          hasCustomBranding: false,
          hasApiAccess: false,
          monthlyPrice: proPlan, // 29.99
        };
      
      case SaasPlan.BUSINESS:
        return {
          agendaMode: AgendaMode.PAR_TATOUEUR,
          maxAppointments: -1, // Illimité
          maxClients: -1,      // Illimité
          maxTattooeurs: -1,   // Illimité
          maxPortfolioImages: -1, // Illimité
          hasAdvancedStats: true,
          hasEmailReminders: true,
          hasCustomBranding: true,
          hasApiAccess: true,
          monthlyPrice: businessPlan, // 59.99
        };
      
      default:
        throw new BadRequestException('Plan inconnu');
    }
  }

  /**
   * 🆙 PASSER AU PLAN MEDIUM
   */
  async upgradeToMedium(userId: string, endDate?: Date | null) {
    return await this.updateUserPlan(userId, SaasPlan.PRO, endDate);
  }

  /**
   * 🚀 PASSER AU PLAN PREMIUM
   */
  async upgradeToPremium(userId: string, endDate?: Date | null) {
    return await this.updateUserPlan(userId, SaasPlan.BUSINESS, endDate);
  }

  /**
   * 🔧 CORRIGER UN PLAN EXISTANT (HELPER POUR DEBUG)
   */
  async fixExistingPlan(userId: string) {
    const planDetails = await this.prisma.saasPlanDetails.findUnique({
      where: { userId },
    });

    if (!planDetails) {
      throw new BadRequestException('Aucun plan trouvé pour cet utilisateur');
    }

    const planConfig = this.getPlanConfiguration(planDetails.currentPlan);
    
    return await this.prisma.saasPlanDetails.update({
      where: { userId },
      data: {
        ...planConfig,
      },
    });
  }
}
