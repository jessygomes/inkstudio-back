import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { assertProfessionalCanMessage } from 'src/messaging/plan-access';
import {
  ExploreProjectsDto,
  PublishProjectDto,
  ReportProfessionalDto,
} from './dto/project.dto';
import { MessageNotificationService } from 'src/messaging/notifications/message-notification.service';
import { ProjectProposalEmailService } from './project-proposal-email.service';
import { PROJECT_PROPOSAL_EMAIL_THRESHOLDS } from 'src/email/project-proposal-email';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private notifications: MessageNotificationService,
    private proposalEmails: ProjectProposalEmailService,
  ) {}

  async options() {
    const [styles, categories] = await Promise.all([
      this.prisma.style.findMany({
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.tattooCategory.findMany({
        where: { isActive: true },
        select: { name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return {
      styles: styles.map((s) => s.name),
      categories: categories.map((c) => c.name),
    };
  }

  private async client(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (user?.role !== 'client')
      throw new ForbiddenException('Compte client requis.');
  }

  private async professional(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, salonId: true, saasPlanDetails: true },
    });
    if (
      !user ||
      !['user', 'user_salon', 'user_tatoueur'].includes(user.role) ||
      (user.role === 'user_tatoueur' && user.salonId)
    )
      throw new ForbiddenException(
        'Explorer est réservé aux salons et indépendants abonnés.',
      );
    await assertProfessionalCanMessage(this.prisma, id);
    if (user.saasPlanDetails && user.saasPlanDetails.planStatus !== 'ACTIVE')
      throw new ForbiddenException(
        'Un abonnement actif est requis pour Explorer.',
      );
  }

  async publish(id: string, userId: string, dto: PublishProjectDto) {
    await this.client(userId);
    const board = await this.prisma.moodboard.findFirst({
      where: { id, clientProfile: { userId } },
    });
    if (!board) throw new NotFoundException('Moodboard introuvable.');
    const normalize = (values: string[], hashtag = false) => [
      ...new Set(
        (values ?? [])
          .map((v) =>
            v
              .trim()
              .toLowerCase()
              .replace(hashtag ? /^#+/ : /^$/, ''),
          )
          .filter(Boolean),
      ),
    ];
    return this.prisma.moodboard.update({
      where: { id },
      data: {
        projectStatus: dto.status,
        ...(dto.city !== undefined && {
          projectCity: dto.city?.trim() || null,
        }),
        ...(dto.category !== undefined && {
          projectCategory: dto.category?.trim() || null,
        }),
        ...(dto.size !== undefined && { projectSize: dto.size || null }),
        ...(dto.styles !== undefined && {
          projectStyles: normalize(dto.styles),
        }),
        ...(dto.hashtags !== undefined && {
          projectHashtags: normalize(dto.hashtags, true),
        }),
        ...(dto.bodyPlacement !== undefined && {
          projectBodyPlacement: dto.bodyPlacement?.trim() || null,
        }),
        ...(dto.mobility !== undefined && {
          projectMobility: dto.mobility || null,
          projectRadiusKm: dto.mobility === 'RADIUS' ? dto.radiusKm : null,
        }),
        ...(dto.status === 'OPEN' &&
          !board.publishedAt && { publishedAt: new Date() }),
      },
    });
  }

  async explore(userId: string, filters: ExploreProjectsDto) {
    await this.professional(userId);
    const blocks = await this.prisma.professionalBlock.findMany({
      where: { professionalId: userId },
      select: { clientUserId: true },
    });
    const where = {
      ...(filters.scope === 'proposals'
        ? {
            proposals: {
              some: {
                professionalId: userId,
                ...(filters.proposalStatus && {
                  status: filters.proposalStatus,
                }),
              },
            },
          }
        : {
            projectStatus: 'OPEN',
            clientProfile: {
              userId: { notIn: blocks.map((b) => b.clientUserId) },
            },
          }),
      ...(filters.city && {
        projectCity: {
          contains: filters.city.trim(),
          mode: 'insensitive' as const,
        },
      }),
      ...(filters.category && {
        projectCategory: {
          equals: filters.category.trim(),
          mode: 'insensitive' as const,
        },
      }),
      ...(filters.size && { projectSize: filters.size }),
      ...(filters.style && {
        projectStyles: { has: filters.style.trim().toLowerCase() },
      }),
      ...(filters.hashtag && {
        projectHashtags: {
          has: filters.hashtag.trim().replace(/^#+/, '').toLowerCase(),
        },
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.moodboard.findMany({
        where,
        skip: (filters.page - 1) * 12,
        take: 12,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          description: true,
          projectCity: true,
          projectCategory: true,
          projectSize: true,
          projectStyles: true,
          projectHashtags: true,
          projectBodyPlacement: true,
          projectMobility: true,
          projectRadiusKm: true,
          images: {
            orderBy: { position: 'asc' },
            select: { id: true, url: true, caption: true },
          },
          proposals: {
            where: { professionalId: userId },
            select: { id: true, status: true, message: true, conversationId: true },
          },
        },
      }),
      this.prisma.moodboard.count({ where }),
    ]);
    return {
      data: data.map((board) => ({
        ...board,
        proposals: board.proposals.map((proposal) => ({
          ...proposal,
          conversationId:
            proposal.status === 'ACCEPTED' ? proposal.conversationId : null,
        })),
      })),
      total,
      page: filters.page,
      totalPages: Math.ceil(total / 12),
    };
  }

  async propose(id: string, userId: string, message: string) {
    await this.professional(userId);
    if (!message.trim())
      throw new BadRequestException('Un premier message est requis.');
    // A proposal is private until the client accepts. Never touch messaging here.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      // Professionals can submit simultaneously. Serialize the per-project count.
      await tx.$queryRaw`SELECT id FROM "Moodboard" WHERE id = ${id} FOR UPDATE`;
      const board = await tx.moodboard.findUnique({
        where: { id },
        include: { clientProfile: true },
      });
      if (!board || board.projectStatus !== 'OPEN')
        throw new NotFoundException('Projet indisponible.');
      const clientUserId = board.clientProfile.userId;
      if (
        await tx.professionalBlock.findUnique({
          where: {
            clientUserId_professionalId: {
              clientUserId,
              professionalId: userId,
            },
          },
        })
      )
        throw new ForbiddenException('Contact indisponible.');
      if (
        await tx.projectProposal.findUnique({
          where: {
            moodboardId_professionalId: {
              moodboardId: id,
              professionalId: userId,
            },
          },
        })
      )
        throw new ConflictException(
          'Vous avez déjà proposé vos services pour ce projet.',
        );
      const proposal = await tx.projectProposal.create({
        data: {
          moodboardId: id,
          professionalId: userId,
          clientUserId,
          message: message.trim(),
        },
        select: { id: true, status: true, createdAt: true },
      });
      const count = await tx.projectProposal.count({
        where: { moodboardId: id },
      });
      const emailQueued = PROJECT_PROPOSAL_EMAIL_THRESHOLDS.some(
        (threshold) => threshold === count,
      );
      if (emailQueued)
        await tx.projectProposalEmail.upsert({
          where: {
            moodboardId_threshold: { moodboardId: id, threshold: count },
          },
          create: { moodboardId: id, threshold: count },
          update: {},
        });
      return { proposal, emailQueued };
    });
    if (result.emailQueued) await this.proposalEmails.requestDelivery();
    return result.proposal;
  }

  async list(userId: string, conversationId?: string, moodboardId?: string) {
    await this.client(userId);
    const proposals = await this.prisma.projectProposal.findMany({
      where: {
        clientUserId: userId,
        ...(conversationId && { conversationId }),
        ...(moodboardId && { moodboardId }),
      },
      include: { moodboard: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: proposals.map((p) => p.professionalId) } },
      select: {
        id: true,
        salonName: true,
        firstName: true,
        lastName: true,
        image: true,
      },
    });
    const blocks = await this.prisma.professionalBlock.findMany({
      where: { clientUserId: userId },
    });
    return proposals.map((p) => ({
      ...p,
      professional: users.find((u) => u.id === p.professionalId),
      blocked: blocks.some((b) => b.professionalId === p.professionalId),
    }));
  }

  async respond(id: string, userId: string, status: string) {
    await this.client(userId);
    const proposal = await this.prisma.projectProposal.findFirst({
      where: { id, clientUserId: userId },
    });
    if (!proposal) throw new NotFoundException('Demande introuvable.');
    if (proposal.status !== 'PENDING')
      throw new ConflictException('Cette demande a déjà reçu une réponse.');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${proposal.professionalId} FOR UPDATE`;
      if (
        status === 'ACCEPTED' &&
        (await tx.professionalBlock.findUnique({
          where: {
            clientUserId_professionalId: {
              clientUserId: userId,
              professionalId: proposal.professionalId,
            },
          },
        }))
      )
        throw new ForbiddenException(
          'Débloquez ce professionnel avant de répondre.',
        );
      const claimed = await tx.projectProposal.updateMany({
        where: { id, status: 'PENDING' },
        data: { status, respondedAt: new Date() },
      });
      if (!claimed.count) throw new ConflictException('Demande déjà traitée.');
      if (status === 'ACCEPTED') {
        // The same professional lock is used by all conversation creation paths.
        const existing = await tx.conversation.findFirst({
          where: { salonId: proposal.professionalId, clientUserId: userId },
          orderBy: { createdAt: 'asc' },
        });
        const conversation =
          existing ||
          (await tx.conversation.create({
            data: { salonId: proposal.professionalId, clientUserId: userId },
          }));
        await tx.projectProposal.update({
          where: { id },
          data: { conversationId: conversation.id },
        });
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: proposal.professionalId,
            type: 'TEXT',
            content: proposal.message,
          },
        });
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            type: 'SYSTEM',
            content: 'La demande de contact pour ce projet a été acceptée.',
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            projectContactPending: false,
            lastMessageAt: new Date(),
            status: 'ACTIVE',
          },
        });
        await tx.inboxThread.upsert({
          where: { conversationId: conversation.id },
          create: {
            conversationId: conversation.id,
            ownerUserId: proposal.professionalId,
            channel: 'INKERA',
            lastMessageAt: new Date(),
          },
          update: {
            lastMessageAt: new Date(),
            archivedAt: null,
            status: 'NEW',
          },
        });
      } else {
        await tx.projectProposal.update({
          where: { id },
          data: { conversationId: null },
        });
      }
      return tx.projectProposal.findUniqueOrThrow({ where: { id } });
    });
    if (result.conversationId)
      await this.notifications.incrementUnreadCount(
        result.conversationId,
        proposal.professionalId,
      );
    return result;
  }

  async block(userId: string, professionalId: string, blocked: boolean) {
    await this.client(userId);
    await this.assertProfessionalTarget(professionalId);
    if (blocked)
      return this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${professionalId} FOR UPDATE`;
        await tx.projectProposal.updateMany({
          where: { clientUserId: userId, professionalId, status: 'PENDING' },
          data: { status: 'REFUSED', respondedAt: new Date() },
        });
        return tx.professionalBlock.upsert({
          where: {
            clientUserId_professionalId: {
              clientUserId: userId,
              professionalId,
            },
          },
          create: { clientUserId: userId, professionalId },
          update: {},
        });
      });
    return this.prisma.professionalBlock.deleteMany({
      where: { clientUserId: userId, professionalId },
    });
  }

  async report(
    userId: string,
    professionalId: string,
    dto: ReportProfessionalDto,
  ) {
    await this.client(userId);
    await this.assertProfessionalTarget(professionalId);
    if (
      dto.proposalId &&
      !(await this.prisma.projectProposal.findFirst({
        where: { id: dto.proposalId, clientUserId: userId, professionalId },
      }))
    )
      throw new NotFoundException('Demande introuvable.');
    if (dto.reason.trim().length < 5)
      throw new BadRequestException('Précisez le motif du signalement.');
    return this.prisma.professionalReport.create({
      data: {
        clientUserId: userId,
        professionalId,
        proposalId: dto.proposalId,
        reason: dto.reason.trim(),
      },
    });
  }

  private async assertProfessionalTarget(id: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (
      !target ||
      !['user', 'user_salon', 'user_tatoueur'].includes(target.role)
    )
      throw new NotFoundException('Professionnel introuvable.');
  }
}
