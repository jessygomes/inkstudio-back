import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { randomBytes } from 'crypto';
import {
  invitationEndDate,
  invitationTokenHash,
} from 'src/auth/invitation-policy';
import {
  CreateSubscriptionInvitationDto,
  UpdateInvitationDurationDto,
} from './dto/subscription-invitation.dto';
import { SaasService } from 'src/saas/saas.service';
import { SaasPlan, SaasPlanStatus } from '@prisma/client';

const publicSelect = {
  id: true,
  email: true,
  role: true,
  plan: true,
  durationMonths: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  maxUses: true,
  useCount: true,
  redemptions: {
    select: {
      id: true,
      userId: true,
      redeemedAt: true,
      durationMonths: true,
      plan: true,
      user: { select: { email: true } },
    },
    orderBy: { redeemedAt: 'desc' as const },
  },
} as const;

@Injectable()
export class SubscriptionInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly saas: SaasService,
  ) {}

  async list() {
    const invitations = await this.prisma.subscriptionInvitation.findMany({
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return invitations.map((invitation) => ({
      ...invitation,
      redemptions: invitation.redemptions.map((redemption) => ({
        ...redemption,
        offerEndsAt: invitationEndDate(
          redemption.redeemedAt,
          redemption.durationMonths,
        ),
      })),
    }));
  }

  async create(dto: CreateSubscriptionInvitationDto, adminId: string) {
    if (!dto.role && dto.plan)
      throw new BadRequestException(
        'Laissez aussi la formule au choix lorsque le type de compte est libre.',
      );
    if (dto.role === 'user_tatoueur' && dto.plan === 'BUSINESS')
      throw new BadRequestException('Business est réservé aux salons.');
    const email = dto.email?.trim().toLowerCase() || null;
    const maxUses = dto.maxUses ?? 1;
    if (email && maxUses !== 1)
      throw new BadRequestException(
        'Une invitation personnelle est limitée à une inscription.',
      );
    if (email && (await this.prisma.user.findUnique({ where: { email } })))
      throw new BadRequestException('Un compte existe déjà avec cet email.');
    const base = process.env.FRONTEND_URL?.replace(/\/$/, '');
    if (!base)
      throw new BadRequestException('FRONTEND_URL doit être configurée.');
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.subscriptionInvitation.create({
      data: {
        email,
        role: dto.role ?? null,
        plan: dto.plan ?? null,
        maxUses,
        durationMonths: dto.durationMonths ?? 12,
        tokenHash: invitationTokenHash(token),
        createdById: adminId,
        expiresAt: new Date(Date.now() + (dto.validityDays ?? 30) * 86400000),
      },
      select: publicSelect,
    });
    return { invitation, url: `${base}/invitation?token=${token}` };
  }

  // Kept for callers that only change the offer duration.
  updateDuration(id: string, durationMonths: number) {
    return this.update(id, { durationMonths });
  }

  async update(id: string, dto: UpdateInvitationDurationDto) {
    if (
      dto.durationMonths == null &&
      dto.maxUses == null &&
      dto.expiresAt == null
    )
      throw new BadRequestException('Aucune modification fournie.');
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the link before reading the counter, serializing edits with signups.
      const locked = await tx.subscriptionInvitation.updateMany({
        where: { id, revokedAt: null },
        data: { useCount: { increment: 0 } },
      });
      if (!locked.count)
        throw new NotFoundException('Invitation introuvable ou révoquée.');
      const invitation = await tx.subscriptionInvitation.findUniqueOrThrow({
        where: { id },
        include: {
          redemptions: {
            include: { user: { include: { saasPlanDetails: true } } },
          },
        },
      });
      const maxUses = dto.maxUses ?? invitation.maxUses;
      if (maxUses < invitation.useCount)
        throw new BadRequestException(
          'Le quota ne peut pas être inférieur au nombre d’inscriptions déjà effectuées.',
        );
      if (invitation.email && maxUses !== 1)
        throw new BadRequestException(
          'Une invitation personnelle est limitée à une inscription.',
        );
      if (dto.durationMonths != null) {
        for (const redemption of invitation.redemptions) {
          const user = redemption.user;
          if (!user) continue;
          // A later paid subscription is independent of the invitation offer.
          if (
            user.stripeSubscriptionId ||
            user.saasPlanDetails?.firstPaidPlanAt ||
            user.saasPlanDetails?.paymentMethod !== 'INVITATION'
          )
            continue;
          const endDate = invitationEndDate(
            redemption.redeemedAt,
            dto.durationMonths,
          );
          const active = endDate > new Date();
          const plan = active ? redemption.plan : SaasPlan.FREE;
          await tx.user.update({
            where: { id: user.id },
            data: { saasPlan: plan, saasPlanUntil: active ? endDate : null },
          });
          await tx.saasPlanDetails.update({
            where: { userId: user.id },
            data: {
              ...this.saas.getPlanConfiguration(plan),
              currentPlan: plan,
              planStatus: active
                ? SaasPlanStatus.ACTIVE
                : SaasPlanStatus.EXPIRED,
              endDate: active ? endDate : null,
              monthlyPrice: 0,
              yearlyPrice: 0,
              trialEndDate: null,
              nextPaymentDate: null,
            },
          });
          await tx.subscriptionInvitationRedemption.update({
            where: { id: redemption.id },
            data: { durationMonths: dto.durationMonths },
          });
        }
      }
      return tx.subscriptionInvitation.update({
        where: { id },
        data: {
          ...(dto.durationMonths != null
            ? { durationMonths: dto.durationMonths }
            : {}),
          ...(dto.maxUses != null ? { maxUses: dto.maxUses } : {}),
          ...(dto.expiresAt != null
            ? { expiresAt: new Date(dto.expiresAt) }
            : {}),
        },
        select: publicSelect,
      });
    });
    await this.cache.delPattern('admin:*');
    await this.cache.delPattern('user:*');
    return result;
  }

  async revoke(id: string) {
    const result = await this.prisma.subscriptionInvitation.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count)
      throw new BadRequestException('Invitation introuvable ou déjà révoquée.');
    return { success: true };
  }
}
