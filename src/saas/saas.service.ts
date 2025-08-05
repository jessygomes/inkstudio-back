import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SaasPlan, SaasPlanStatus } from '@prisma/client';
import { freePlan, proPlan, businessPlan } from '../../utils/data';

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

  /**
   * 📊 VÉRIFIER LES LIMITES D'UTILISATION
   */
  async checkLimits(userId: string) {
    const planDetails = await this.getUserPlanDetails(userId);
    
    // Compter l'utilisation actuelle
    const [appointmentsCount, clientsCount, tattoeursCount, portfolioCount] = await Promise.all([
      this.getMonthlyAppointmentsCount(userId),
      this.prisma.client.count({ where: { userId } }),
      this.prisma.tatoueur.count({ where: { userId } }),
      this.prisma.portfolio.count({ where: { userId } }),
    ]);

    return {
      planDetails,
      usage: {
        appointments: appointmentsCount,
        clients: clientsCount,
        tattooeurs: tattoeursCount,
        portfolioImages: portfolioCount,
      },
      limits: {
        appointments: planDetails.maxAppointments,
        clients: planDetails.maxClients,
        tattooeurs: planDetails.maxTattooeurs,
        portfolioImages: planDetails.maxPortfolioImages,
      },
      hasReached: {
        appointments: planDetails.maxAppointments !== -1 && appointmentsCount >= planDetails.maxAppointments,
        clients: planDetails.maxClients !== -1 && clientsCount >= planDetails.maxClients,
        tattooeurs: planDetails.maxTattooeurs !== -1 && tattoeursCount >= planDetails.maxTattooeurs,
        portfolioImages: planDetails.maxPortfolioImages !== -1 && portfolioCount >= planDetails.maxPortfolioImages,
      },
    };
  }

  /**
   * ✅ VÉRIFIER SI UNE ACTION EST AUTORISÉE
   */
  async canPerformAction(userId: string, action: 'appointment' | 'client' | 'tatoueur' | 'portfolio'): Promise<boolean> {
    const limits = await this.checkLimits(userId);
    
    // Mapper les actions vers les clés correctes
    const limitKey = action === 'appointment' ? 'appointments' : 
                    action === 'client' ? 'clients' :
                    action === 'tatoueur' ? 'tattooeurs' : 
                    action === 'portfolio' ? 'portfolioImages' : action;

    const currentLimit = limits.limits[limitKey];
    
    // Si la limite est -1 (illimitée), toujours autoriser
    if (currentLimit === -1) {
      return true;
    }
    
    return !limits.hasReached[limitKey];
  }

  /**
   * 🚫 VÉRIFIER ET LANCER UNE ERREUR SI LIMITE ATTEINTE
   */
  async enforceLimit(userId: string, action: 'appointment' | 'client' | 'tatoueur' | 'portfolio') {
    const canPerform = await this.canPerformAction(userId, action);
    
    if (!canPerform) {
      const limits = await this.checkLimits(userId);
      const actionName = {
        appointment: 'rendez-vous',
        client: 'fiches clients',
        tatoueur: 'tatoueurs',
        portfolio: 'images portfolio'
      }[action];
      
      throw new BadRequestException(
        `Limite ${actionName} atteinte (${limits.limits[action === 'appointment' ? 'appointments' : action === 'tatoueur' ? 'tattooeurs' : action === 'portfolio' ? 'portfolioImages' : action]}). Passez au plan PRO ou BUSINESS pour continuer.`
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
   * 📅 COMPTER LES RDV DU MOIS EN COURS
   */
  private async getMonthlyAppointmentsCount(userId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return await this.prisma.appointment.count({
      where: {
        userId,
        start: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });
  }

  /**
   * 🔄 METTRE À JOUR LE PLAN D'UN UTILISATEUR
   */
  async updateUserPlan(userId: string, plan: SaasPlan, endDate?: Date | null) {
    const planConfig = this.getPlanConfiguration(plan);
    
    // Si pas de date d'expiration fournie, calculer automatiquement
    if (!endDate) {
      endDate = plan !== SaasPlan.FREE 
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 an
        : null;
    }
    
    // Utiliser une transaction pour maintenir la cohérence entre les deux tables
    return await this.prisma.$transaction(async (prisma) => {
      // Mettre à jour le plan dans la table User
      await prisma.user.update({
        where: { id: userId },
        data: {
          saasPlan: plan,
          saasPlanUntil: endDate,
        },
      });

      // Mettre à jour ou créer les détails du plan SaaS
      return await prisma.saasPlanDetails.upsert({
        where: { userId },
        update: {
          currentPlan: plan,
          planStatus: SaasPlanStatus.ACTIVE,
          endDate,
          ...planConfig,
        },
        create: {
          userId,
          currentPlan: plan,
          planStatus: SaasPlanStatus.ACTIVE,
          endDate,
          ...planConfig,
        },
      });
    });
  }

  /**
   * ⚙️ CONFIGURATION DES PLANS
   */
  private getPlanConfiguration(plan: SaasPlan) {
    switch (plan) {
      case SaasPlan.FREE:
        return {
          maxAppointments: 5,   // 5 RDV par mois
          maxClients: 5,        // 5 clients max
          maxTattooeurs: 1,
          maxPortfolioImages: 5,
          hasAdvancedStats: false,
          hasEmailReminders: false,
          hasCustomBranding: false,
          hasApiAccess: false,
          monthlyPrice: freePlan, // 0
        };
      
      case SaasPlan.PRO:
        return {
          maxAppointments: 150,
          maxClients: 200,
          maxTattooeurs: 3,
          maxPortfolioImages: 30,
          hasAdvancedStats: true,
          hasEmailReminders: true,
          hasCustomBranding: false,
          hasApiAccess: false,
          monthlyPrice: proPlan, // 29.99
        };
      
      case SaasPlan.BUSINESS:
        return {
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
   * 📊 OBTENIR LES STATISTIQUES D'UTILISATION
   */
  async getUsageStats(userId: string) {
    const limits = await this.checkLimits(userId);
    
    return {
      plan: limits.planDetails.currentPlan,
      status: limits.planDetails.planStatus,
      endDate: limits.planDetails.endDate,
      usage: limits.usage,
      limits: limits.limits,
      percentageUsed: {
        appointments: limits.limits.appointments === -1 ? 0 : Math.round((limits.usage.appointments / limits.limits.appointments) * 100),
        clients: limits.limits.clients === -1 ? 0 : Math.round((limits.usage.clients / limits.limits.clients) * 100),
        tattooeurs: limits.limits.tattooeurs === -1 ? 0 : Math.round((limits.usage.tattooeurs / limits.limits.tattooeurs) * 100),
        portfolioImages: limits.limits.portfolioImages === -1 ? 0 : Math.round((limits.usage.portfolioImages / limits.limits.portfolioImages) * 100),
      },
      features: {
        advancedStats: limits.planDetails.hasAdvancedStats,
        emailReminders: limits.planDetails.hasEmailReminders,
        customBranding: limits.planDetails.hasCustomBranding,
        apiAccess: limits.planDetails.hasApiAccess,
      },
    };
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
