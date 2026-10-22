import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import {
  ConversationResponseDto,
  ConversationParticipantDto,
  LastMessageDto,
} from './dto/conversation-response.dto';
import { PaginatedConversationsDto } from './dto/paginated-conversations.dto';
import { UnreadConversationResponseDto } from './dto/unread-conversation-response.dto';
import { ConversationStatus, InboxChannel, MessageType, Prisma, SaasPlan, SaasPlanStatus } from '@prisma/client';
import { MessageNotificationService } from '../notifications/message-notification.service';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private notificationService: MessageNotificationService,
  ) {}

  /**
   * Point d'entrée public : le client Inkera démarre une conversation sans RDV.
   * L'identité du professionnel provient du profil public (et non du client).
   */
  async startConversationAsClient(
    clientUserId: string,
    professionalUserId: string,
  ): Promise<ConversationResponseDto> {
    const client = await this.prisma.user.findUnique({
      where: { id: clientUserId },
    });
    if (!client || client.role !== 'client') {
      throw new ForbiddenException('Un compte client Inkera est nécessaire');
    }

    const professional = await this.prisma.user.findUnique({
      where: { id: professionalUserId },
    });
    if (
      !professional ||
      !['user', 'user_salon', 'user_tatoueur'].includes(professional.role)
    ) {
      throw new NotFoundException('Profil professionnel introuvable');
    }

    // Seuls les professionnels payants reçoivent de nouveaux messages Inkera.
    // Un professionnel déjà expiré ou résilié doit renouveler son abonnement.
    const details = await this.prisma.saasPlanDetails.findUnique({
      where: { userId: professionalUserId },
    });
    const expired = professional.saasPlanUntil !== null &&
      professional.saasPlanUntil < new Date();
    const inactiveDetails = details && (
      details.currentPlan === SaasPlan.FREE ||
      details.planStatus === SaasPlanStatus.EXPIRED ||
      details.planStatus === SaasPlanStatus.CANCELED ||
      (details.endDate !== null && details.endDate < new Date())
    );

    if (professional.saasPlan === SaasPlan.FREE || expired || inactiveDetails) {
      throw new ForbiddenException('La messagerie est réservée aux professionnels abonnés');
    }

    return this.createConversation(professionalUserId, { clientUserId });
  }

  /**
   * Une seule conversation Inkera par professionnel et client connecté.
   * Les RDV successifs sont ajoutés à l'InboxThread de cette conversation.
   */
  async createConversation(
    salonId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    // Vérifier que le client existe et a le bon rôle
    const client = await this.prisma.user.findUnique({
      where: { id: dto.clientUserId },
    });

    if (!client) {
      throw new NotFoundException('Client non trouvé');
    }

    if (client.role !== 'client') {
      throw new BadRequestException(
        'Cet utilisateur n\'est pas un client',
      );
    }

    // Vérifier que le salon existe
    const salon = await this.prisma.user.findUnique({
      where: { id: salonId },
    });

    if (!salon) {
      throw new NotFoundException('Salon non trouvé');
    }

    if (!['user', 'user_salon', 'user_tatoueur'].includes(salon.role)) {
      throw new ForbiddenException('Seul un compte professionnel peut créer cette conversation');
    }

    // Interdire qu'un RDV d'un autre professionnel/client soit lié ici.
    if (dto.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException('Rendez-vous non trouvé');
      }

      if (appointment.userId !== salonId) {
        throw new ForbiddenException('Ce rendez-vous appartient à un autre professionnel');
      }

      if (appointment.clientUserId !== dto.clientUserId) {
        // Compatibilité avec un RDV CRM initialement créé sans clientUserId.
        const linkedClient = appointment.clientId
          ? await this.prisma.client.findUnique({ where: { id: appointment.clientId } })
          : null;

        if (
          appointment.clientUserId ||
          !linkedClient ||
          linkedClient.userId !== salonId ||
          linkedClient.linkedUserId !== dto.clientUserId
        ) {
          throw new ForbiddenException('Ce rendez-vous ne correspond pas à ce client');
        }
      }
    }

    const include = {
      salon: true,
      clientUser: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    } as const;

    // La recherche ne dépend plus de appointmentId : un client peut avoir
    // plusieurs RDV, mais une seule conversation Inkera par professionnel.
    let conversation = await this.prisma.conversation.findFirst({
      where: { salonId, clientUserId: dto.clientUserId },
      orderBy: { createdAt: 'asc' },
      include,
    });

    const wasCreated = !conversation;
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          salonId,
          clientUserId: dto.clientUserId,
          appointmentId: dto.appointmentId,
          subject: dto.subject,
          status: ConversationStatus.ACTIVE,
        },
        include,
      });
    }

    // L'inbox est propriétaire des associations multiples aux RDV.
    const appointmentWasLinked = await this.ensureInboxThread(
      conversation,
      dto.appointmentId,
    );

    // Message initial : à la création du fil ou pour un nouveau RDV seulement.
    // Une relance identique d'une association déjà existante n'envoie rien.
    if (dto.firstMessage && (wasCreated || !dto.appointmentId || appointmentWasLinked)) {
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: salonId,
          content: dto.firstMessage,
          type: MessageType.SYSTEM,
        },
      });

      await this.notificationService.incrementUnreadCount(
        conversation.id,
        dto.clientUserId,
      );
    }

    return this.mapToResponseDto(conversation, salonId);
  }

  /**
   * Associe la conversation Inkera à son fil d'inbox et, si présent, à un RDV.
   * Retourne true uniquement lorsqu'un nouveau lien RDV a été créé.
   */
  private async ensureInboxThread(
    conversation: {
      id: string;
      salonId: string;
      appointmentId: string | null;
      lastMessageAt: Date;
    },
    appointmentId?: string,
  ): Promise<boolean> {
    const thread = await this.prisma.inboxThread.upsert({
      where: { conversationId: conversation.id },
      create: {
        ownerUserId: conversation.salonId,
        channel: InboxChannel.INKERA,
        conversationId: conversation.id,
        lastMessageAt: conversation.lastMessageAt,
      },
      update: {},
    });

    if (!appointmentId) {
      return false;
    }

    try {
      await this.prisma.inboxThreadAppointment.create({
        data: { inboxThreadId: thread.id, appointmentId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }

    // Compatibilité temporaire avec le frontend historique qui n'affiche qu'un
    // seul appointmentId, sans empêcher les autres liens dans la nouvelle table.
    if (!conversation.appointmentId) {
      const existingLegacyLink = await this.prisma.conversation.findUnique({
        where: { appointmentId },
        select: { id: true },
      });

      if (!existingLegacyLink) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { appointmentId },
        });
      }
    }

    return true;
  }

  /**
   * Récupère toutes les conversations d'un utilisateur (paginé)
   */
  async getConversations(
    userId: string,
    page: number = 1,
    limit: number = 20,
    status?: ConversationStatus,
  ): Promise<PaginatedConversationsDto> {
    const skip = (page - 1) * limit;

    const where = {
      OR: [{ salonId: userId }, { clientUserId: userId }],
      ...(status && { status }),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          salon: true,
          clientUser: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const data = await Promise.all(
      conversations.map((conv) => this.mapToResponseDto(conv, userId)),
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Rendez-vous du client connecté avec ce professionnel, indépendamment de la conversation d'origine. */
  async getClientAppointments(conversationId: string, currentUserId: string, page = 1) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { salonId: true, clientUserId: true },
    });
    if (!conversation) throw new NotFoundException('Conversation non trouvée');
    if (conversation.clientUserId !== currentUserId) {
      throw new ForbiddenException('Seul le client concerné peut consulter ses rendez-vous');
    }

    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const where: Prisma.AppointmentWhereInput = {
      clientUserId: currentUserId,
      OR: [{ userId: conversation.salonId }, { performerUserId: conversation.salonId }],
    };
    const [data, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ start: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * 5,
        take: 5,
        select: { id: true, title: true, prestation: true, start: true, end: true, status: true },
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { data, total, page: safePage, totalPages: Math.ceil(total / 5) };
  }

  /**
   * Récupère les 10 premières conversations avec messages non lus par le salon uniquement
   * Retourne le dernier message et les infos du client
   */
  async getConversationsWithUnreadMessages(
    salonId: string,
  ): Promise<UnreadConversationResponseDto[]> {
    // Récupérer les conversations où le salon a des messages non lus envoyés par le client
    const conversationsWithUnread = await this.prisma.conversation.findMany({
      where: {
        salonId: salonId,
        status: ConversationStatus.ACTIVE,
        messages: {
          some: {
            senderId: { not: salonId }, // Messages envoyés par le client
            isRead: false,
          },
        },
      },
      include: {
        clientUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            image: true,
          },
        },
        messages: {
          where: {
            senderId: { not: salonId },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    });

    // Mapper les résultats
    const data = await Promise.all(
      conversationsWithUnread.map(async (conv) => {
        const unreadCount = await this.notificationService.getUnreadCount(
          conv.id,
          salonId,
        );

        const lastMessage = conv.messages[0];

        return {
          conversationId: conv.id,
          subject: conv.subject,
          clientId: conv.clientUser.id,
          clientFirstName: conv.clientUser.firstName ?? undefined,
          clientLastName: conv.clientUser.lastName ?? undefined,
          clientImage: conv.clientUser.image ?? undefined,
          lastMessage: {
            id: lastMessage.id,
            content: lastMessage.content,
            type: lastMessage.type,
            createdAt: lastMessage.createdAt,
          },
          unreadCount,
          lastMessageAt: conv.lastMessageAt,
        } as UnreadConversationResponseDto;
      }),
    );

    return data;
  }

  /**
   * Récupère une conversation par ID avec vérification des droits
   */
  async getConversationById(
    conversationId: string,
    userId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        salon: true,
        clientUser: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier les droits d'accès
    if (
      conversation.salonId !== userId &&
      conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    // Marquer tous les messages non lus comme lus
    await this.markAllAsRead(conversationId, userId);

    return this.mapToResponseDto(conversation, userId);
  }

  /**
   * Met à jour une conversation (subject, status)
   */
  async updateConversation(
    conversationId: string,
    userId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Vérifier les droits
    if (
      conversation.salonId !== userId &&
      conversation.clientUserId !== userId
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    // Règle métier: seul le salon peut changer le statut (ACTIVE/ARCHIVED).
    // Empêche le contournement de l'endpoint dédié /archive via PATCH standard.
    if (dto.status !== undefined && conversation.salonId !== userId) {
      throw new ForbiddenException(
        'Seul le salon peut modifier le statut de la conversation',
      );
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: dto,
      include: {
        salon: true,
        clientUser: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return this.mapToResponseDto(updated, userId);
  }

  /**
   * Archive une conversation (seul le salon peut archiver)
   */
  async archiveConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Seul le salon peut archiver
    if (conversation.salonId !== userId) {
      throw new ForbiddenException(
        'Seul le salon peut archiver une conversation',
      );
    }

    const newStatus = conversation.status === ConversationStatus.ACTIVE
      ? ConversationStatus.ARCHIVED
      : ConversationStatus.ACTIVE;

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: newStatus },
    });
  }

  /**
   * Supprime une conversation (hard delete - seul le salon)
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    // Seul le salon peut supprimer
    if (conversation.salonId !== userId) {
      throw new ForbiddenException(
        'Seul le salon peut supprimer une conversation',
      );
    }

    // Hard delete (cascade supprime messages, attachments, notifications)
    await this.prisma.conversation.delete({
      where: { id: conversationId },
    });
  }

  /**
   * Marque tous les messages d'une conversation comme lus
   */
  async markAllAsRead(conversationId: string, userId: string): Promise<void> {
    // Marquer tous les messages non lus comme lus
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Réinitialiser le compteur de notifications
    await this.notificationService.resetUnreadCount(conversationId, userId);
  }

  /**
   * Transforme une conversation Prisma en DTO de réponse
   */
  private async mapToResponseDto(
    conversation: {
      id: string;
      salonId: string;
      clientUserId: string;
      appointmentId: string | null;
      subject: string | null;
      status: ConversationStatus;
      createdAt: Date;
      updatedAt: Date;
      lastMessageAt: Date;
      salon: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        salonName: string | null;
        image: string | null;
        profileImage?: string | null;
        role: string;
        city?: string | null;
        postalCode?: string | null;
        address?: string | null;
      };
      clientUser: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        image: string | null;
        role: string;
      };
      messages?: Array<{
        id: string;
        content: string;
        senderId: string;
        type: MessageType;
        createdAt: Date;
      }>;
    },
    currentUserId: string,
  ): Promise<ConversationResponseDto> {
    // Mapper les participants
    const salon: ConversationParticipantDto = {
      id: conversation.salon.id,
      firstName: conversation.salon.firstName ?? undefined,
      lastName: conversation.salon.lastName ?? undefined,
      salonName: conversation.salon.salonName ?? undefined,
      image: conversation.salon.profileImage ?? conversation.salon.image ?? undefined,
      city: conversation.salon.city ?? undefined,
      postalCode: conversation.salon.postalCode ?? undefined,
      address: conversation.salon.address ?? undefined,
      email: conversation.salon.email,
      role: conversation.salon.role,
    };

    const client: ConversationParticipantDto = {
      id: conversation.clientUser.id,
      firstName: conversation.clientUser.firstName ?? undefined,
      lastName: conversation.clientUser.lastName ?? undefined,
      salonName: undefined,
      image: conversation.clientUser.image ?? undefined,
      email: conversation.clientUser.email,
      role: conversation.clientUser.role,
    };

    // Mapper le dernier message
    let lastMessage: LastMessageDto | undefined;
    if (conversation.messages && conversation.messages.length > 0) {
      const msg = conversation.messages[0];
      lastMessage = {
        id: msg.id,
        content: msg.content,
        senderId: msg.senderId,
        type: msg.type,
        createdAt: msg.createdAt,
      };
    }

    // Récupérer le compteur de messages non lus
    const unreadCount = await this.notificationService.getUnreadCount(
      conversation.id,
      currentUserId,
    );

    return {
      id: conversation.id,
      salonId: conversation.salonId,
      clientUserId: conversation.clientUserId,
      appointmentId: conversation.appointmentId ?? undefined,
      subject: conversation.subject ?? undefined,
      status: conversation.status,
      salon,
      client,
      lastMessage,
      unreadCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessageAt: conversation.lastMessageAt,
    };
  }
}
