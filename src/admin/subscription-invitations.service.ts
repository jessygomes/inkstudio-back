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
import { CreateSubscriptionInvitationDto } from './dto/subscription-invitation.dto';
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
  redeemedAt: true,
  redeemedById: true,
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
      offerEndsAt: invitation.redeemedAt
        ? invitationEndDate(invitation.redeemedAt, invitation.durationMonths)
        : null,
    }));
  }

  async create(dto: CreateSubscriptionInvitationDto, adminId: string) {
    if (dto.role === 'user_tatoueur' && dto.plan === 'BUSINESS') {
      throw new BadRequestException('Business est réservé aux salons.');
    }
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('Un compte existe déjà avec cet email.');
    }
    const base = process.env.FRONTEND_URL?.replace(/\/$/, '');
    if (!base)
      throw new BadRequestException('FRONTEND_URL doit être configurée.');
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.subscriptionInvitation.create({
      data: {
        ...dto,
        email,
        durationMonths: dto.durationMonths ?? 12,
        tokenHash: invitationTokenHash(token),
        createdById: adminId,
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
      select: publicSelect,
    });
    return { invitation, url: `${base}/invitation?token=${token}` };
  }

  async updateDuration(id: string, durationMonths: number) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize against registration and other changes to this invitation.
      const locked = await tx.subscriptionInvitation.updateMany({
        where: { id, revokedAt: null },
        data: { durationMonths },
      });
      if (!locked.count)
        throw new NotFoundException('Invitation introuvable ou révoquée.');
      const invitation = await tx.subscriptionInvitation.findUniqueOrThrow({
        where: { id },
      });
      if (invitation.redeemedById && invitation.redeemedAt) {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: invitation.redeemedById },
          include: { saasPlanDetails: true },
        });
        if (
          user.stripeSubscriptionId ||
          user.saasPlanDetails?.firstPaidPlanAt ||
          user.saasPlanDetails?.paymentMethod !== 'INVITATION'
        ) {
          throw new BadRequestException(
            'Ce compte utilise désormais un autre abonnement.',
          );
        }
        const endDate = invitationEndDate(
          invitation.redeemedAt,
          durationMonths,
        );
        const active = endDate > new Date();
        const plan = active ? invitation.plan : SaasPlan.FREE;
        await tx.user.update({
          where: { id: user.id },
          data: { saasPlan: plan, saasPlanUntil: active ? endDate : null },
        });
        await tx.saasPlanDetails.update({
          where: { userId: user.id },
          data: {
            ...this.saas.getPlanConfiguration(plan),
            currentPlan: plan,
            planStatus: active ? SaasPlanStatus.ACTIVE : SaasPlanStatus.EXPIRED,
            endDate,
            monthlyPrice: 0,
            yearlyPrice: 0,
            trialEndDate: null,
            nextPaymentDate: null,
          },
        });
      }
      return tx.subscriptionInvitation.findUnique({
        where: { id },
        select: publicSelect,
      });
    });
    await this.cache.delPattern('admin:*');
    await this.cache.delPattern('user:*');
    return result;
  }

  async revoke(id: string) {
    const result = await this.prisma.subscriptionInvitation.updateMany({
      where: { id, redeemedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count)
      throw new BadRequestException(
        'Seule une invitation non utilisée peut être révoquée.',
      );
    return { success: true };
  }
}
