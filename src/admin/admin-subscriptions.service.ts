import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgendaMode, SaasPlan, SaasPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { SaasService } from 'src/saas/saas.service';
import { invitationEndDate } from 'src/auth/invitation-policy';
import { GrantSubscriptionDto } from './dto/grant-subscription.dto';
import { StripeService } from 'src/stripe/stripe.service';

@Injectable()
export class AdminSubscriptionsService {
  private readonly logger = new Logger(AdminSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saas: SaasService,
    private readonly cache: CacheService,
    private readonly stripe?: StripeService,
  ) {}

  async preview(userId: string, dto: GrantSubscriptionDto) {
    if (dto.unit === 'MONTHS' && dto.duration > 120)
      throw new BadRequestException('La durée maximale est de 120 mois.');
    if (!this.stripe)
      throw new BadRequestException('Service Stripe indisponible.');
    return this.stripe.previewAdminGift(userId, dto.duration, dto.unit);
  }

  async grant(userId: string, dto: GrantSubscriptionDto, adminId: string) {
    if (dto.unit === 'MONTHS' && dto.duration > 120)
      throw new BadRequestException('La durée maximale est de 120 mois.');
    const billingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeSubscriptionId: true },
    });
    if (!billingUser) throw new NotFoundException('Utilisateur introuvable.');
    if (billingUser.stripeSubscriptionId) {
      if (!this.stripe || !dto.confirmation || !dto.requestId)
        throw new BadRequestException(
          'Vérifiez et confirmez les dates de reprise Stripe avant d’enregistrer.',
        );
      const gift = await this.stripe.applyAdminGift(
        userId,
        dto.duration,
        dto.unit,
        dto.confirmation,
        dto.requestId,
        adminId,
      );
      const subscription = await this.saas.markStripeGift(
        userId,
        gift.currentPlan as SaasPlan,
        gift.startDate,
        gift.endDate,
        gift.autoResume,
      );
      await this.cache.delPattern('admin:*');
      await this.cache.delPattern('user:*');
      this.logger.log(
        JSON.stringify({
          event: 'admin.subscription.stripe-gift',
          adminId,
          userId,
          startDate: gift.startDate,
          endDate: gift.endDate,
        }),
      );
      return { success: true, subscription, autoResume: gift.autoResume };
    }
    const startDate = new Date();
    const endDate =
      dto.unit === 'MONTHS'
        ? invitationEndDate(startDate, dto.duration)
        : new Date(startDate.getTime() + dto.duration * 86400000);
    const subscription = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, stripeSubscriptionId: true },
      });
      if (!user) throw new NotFoundException('Utilisateur introuvable.');
      if (user.role !== 'user_salon' && user.role !== 'user_tatoueur')
        throw new BadRequestException(
          'Cette offre est réservée aux salons et tatoueurs indépendants.',
        );
      if (user.stripeSubscriptionId)
        throw new BadRequestException(
          'Résiliez d’abord l’abonnement Stripe de ce compte avant de lui accorder une offre gratuite.',
        );
      const plan =
        user.role === 'user_salon' ? SaasPlan.BUSINESS : SaasPlan.PRO;
      // Lock the account and check billing again before changing its entitlement.
      const updated = await tx.user.updateMany({
        where: { id: userId, role: user.role, stripeSubscriptionId: null },
        data: { saasPlan: plan, saasPlanUntil: endDate },
      });
      if (!updated.count)
        throw new BadRequestException(
          'Le compte a été modifié. Rechargez la fiche avant de réessayer.',
        );
      const details = {
        ...this.saas.getPlanConfiguration(plan),
        currentPlan: plan,
        planStatus: SaasPlanStatus.ACTIVE,
        startDate,
        endDate,
        trialEndDate: null,
        nextPaymentDate: null,
        pastDueSince: null,
        monthlyPrice: 0,
        yearlyPrice: 0,
        paymentMethod: 'ADMIN_GIFT',
      };
      return tx.saasPlanDetails.upsert({
        where: { userId },
        update: details,
        create: {
          ...details,
          userId,
          agendaMode:
            user.role === 'user_salon'
              ? AgendaMode.PAR_TATOUEUR
              : AgendaMode.GLOBAL,
        },
      });
    });
    this.logger.log(
      JSON.stringify({
        event: 'admin.subscription.granted',
        adminId,
        userId,
        plan: subscription.currentPlan,
        duration: dto.duration,
        unit: dto.unit,
        startDate,
        endDate,
      }),
    );
    await this.cache.delPattern('admin:*');
    await this.cache.delPattern('user:*');
    await this.cache.delPattern('users:list:*');
    return { success: true, subscription };
  }
}
