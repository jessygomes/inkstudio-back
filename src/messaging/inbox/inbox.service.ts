import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InboxChannel, InboxThreadStatus, MessageType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { MessagesGateway } from '../websocket/messages.gateway';
import { InstagramService } from '../instagram/instagram.service';
import {
  AssignInboxThreadDto, CreateInboxClientDto, InboxMemberPermissionDto, InboxReplyDto,
  ListInboxThreadsDto, SaveInboxReplyDto,
} from './dto/inbox.dto';

/**
 * Contrôle d'accès centralisé de la messagerie professionnelle.
 * La relation User.salonId ET l'affectation ET les permissions doivent coïncider :
 * appartenir à l'équipe ne suffit jamais à consulter toutes les conversations.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: MessageNotificationService,
    @Optional() private readonly gateway?: MessagesGateway,
    @Optional() private readonly instagram?: InstagramService,
  ) {}

  private async getProfessional(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, salonId: true },
    });
    if (!user || (user.role !== Role.user && user.role !== Role.user_salon && user.role !== Role.user_tatoueur)) {
      throw new ForbiddenException('Compte professionnel requis');
    }
    return user;
  }

  private async permission(salonId: string, memberUserId: string) {
    return this.prisma.inboxMemberPermission.findUnique({
      where: { salonId_memberUserId: { salonId, memberUserId } },
    });
  }

  private readonly threadInclude = {
    conversation: {
      select: {
        id: true, salonId: true, clientUserId: true, subject: true,
        clientUser: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
      },
    },
    externalConversation: {
      select: {
        id: true, subject: true, providerThreadId: true,
        contact: { select: { id: true, displayName: true, username: true, email: true } },
        // Ne jamais exposer accessTokenEncrypted / refreshTokenEncrypted.
        connection: { select: { id: true, provider: true, displayName: true, emailAddress: true, status: true } },
      },
    },
    linkedClient: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, linkedUserId: true } },
    assignedUser: { select: { id: true, firstName: true, lastName: true } },
    assignedTatoueur: { select: { id: true, name: true } },
    appointments: { select: { appointmentId: true } },
  } as const;

  private async assertAccess(userId: string, threadId: string, action: 'view' | 'reply' | 'owner' = 'view') {
    const user = await this.getProfessional(userId);
    const thread = await this.prisma.inboxThread.findUnique({
      where: { id: threadId }, include: this.threadInclude,
    });
    if (!thread) throw new NotFoundException('Conversation introuvable');

    if (thread.ownerUserId === user.id) return thread;
    if (action === 'owner') throw new ForbiddenException('Réservé au propriétaire de la boîte');

    // Les artistes externes n'accèdent aux fils du salon que sur affectation.
    if (
      user.role !== Role.user_tatoueur ||
      !user.salonId ||
      user.salonId !== thread.ownerUserId ||
      thread.assignedUserId !== user.id
    ) {
      throw new ForbiddenException('Conversation non attribuée à votre compte');
    }
    const permission = await this.permission(thread.ownerUserId, user.id);
    if (!permission?.canView || (action === 'reply' && !permission.canReply)) {
      throw new ForbiddenException('Accès à cette conversation non autorisé');
    }
    return thread;
  }

  async listThreads(userId: string, filters: ListInboxThreadsDto) {
    const user = await this.getProfessional(userId);
    const scope: Prisma.InboxThreadWhereInput = { ownerUserId: user.id };
    if (user.role === Role.user_tatoueur && user.salonId) {
      const permission = await this.permission(user.salonId, user.id);
      if (permission?.canView) {
        scope.ownerUserId = undefined;
        scope.OR = [
          { ownerUserId: user.id },
          { ownerUserId: user.salonId, assignedUserId: user.id },
        ];
      }
    }
    const where: Prisma.InboxThreadWhereInput = {
      ...scope,
      archivedAt: null,
      ...(filters.channel && { channel: filters.channel }),
      ...(filters.status && { status: filters.status }),
      ...(filters.assignedUserId && { assignedUserId: filters.assignedUserId }),
      ...(filters.assignedTatoueurId && { assignedTatoueurId: filters.assignedTatoueurId }),
      ...(filters.linkedClientId && { linkedClientId: filters.linkedClientId }),
    };
    const conditions: Prisma.InboxThreadWhereInput[] = [];
    if (filters.unreadOnly) {
      conditions.push({ OR: [
        { readStates: { some: { userId, forceUnread: true } } },
        { conversation: { is: { notifications: { some: { userId, unreadCount: { gt: 0 } } } } } },
        ...(user.role === Role.user_tatoueur ? [{ assignedUserId: userId, readStates: { none: { userId } } }] : []),
      ] });
    }
    const search = filters.search?.trim();
    if (search) {
      conditions.push({ OR: [
        { linkedClient: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
        { linkedClient: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
        { linkedClient: { is: { email: { contains: search, mode: 'insensitive' } } } },
        { conversation: { is: { subject: { contains: search, mode: 'insensitive' } } } },
        { conversation: { is: { clientUser: { is: { firstName: { contains: search, mode: 'insensitive' } } } } } },
        { externalConversation: { is: { subject: { contains: search, mode: 'insensitive' } } } },
        { externalConversation: { is: { contact: { is: { displayName: { contains: search, mode: 'insensitive' } } } } } },
      ] });
    }
    if (conditions.length) where.AND = conditions;
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const [data, total] = await Promise.all([
      this.prisma.inboxThread.findMany({
        where, include: this.threadInclude,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.inboxThread.count({ where }),
    ]);
    const threadIds = data.map((item) => item.id);
    const conversationIds = data.map((item) => item.conversationId).filter((id): id is string => Boolean(id));
    const [notifications, states] = await Promise.all([
      conversationIds.length ? this.prisma.messageNotification.findMany({
        where: { userId, conversationId: { in: conversationIds } },
        select: { conversationId: true, unreadCount: true },
      }) : Promise.resolve([]),
      threadIds.length ? this.prisma.inboxReadState.findMany({
        where: { userId, inboxThreadId: { in: threadIds } },
        select: { inboxThreadId: true, forceUnread: true, lastReadAt: true },
      }) : Promise.resolve([]),
    ]);
    const byConversation = new Map<string, number>(notifications.map((item): [string, number] => [item.conversationId, item.unreadCount]));
    const byThread = new Map<string, { forceUnread: boolean; lastReadAt: Date | null }>(
      states.map((item): [string, { forceUnread: boolean; lastReadAt: Date | null }] => [item.inboxThreadId, item]),
    );
    const withUnread = data.map((item) => {
      const state = byThread.get(item.id);
      const legacyCount = item.conversationId ? (byConversation.get(item.conversationId) ?? 0) : 0;
      const newerThanRead = Boolean(item.lastMessageAt && state?.lastReadAt && item.lastMessageAt > state.lastReadAt);
      const memberUnread = item.ownerUserId !== userId && (!state?.lastReadAt || newerThanRead);
      const unreadCount = Math.max(legacyCount, state?.forceUnread || (memberUnread && Boolean(item.lastMessageAt)) ? 1 : 0);
      return { ...item, unreadCount };
    });
    return { data: withUnread, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getThread(userId: string, threadId: string) {
    return this.assertAccess(userId, threadId);
  }

  async getMessages(userId: string, threadId: string, page = 1, limit = 50) {
    const thread = await this.assertAccess(userId, threadId);
    const currentPage = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    if (thread.channel === InboxChannel.INKERA && thread.conversationId) {
      const where = { conversationId: thread.conversationId, archivedAt: null };
      const [data, total] = await Promise.all([
        this.prisma.message.findMany({
          where, orderBy: { createdAt: 'desc' },
          include: { sender: { select: { id: true, firstName: true, lastName: true, salonName: true, image: true } }, attachments: true },
          skip: (currentPage - 1) * pageSize, take: pageSize,
        }),
        this.prisma.message.count({ where }),
      ]);
      return { data, total, page: currentPage, limit: pageSize, hasMore: currentPage * pageSize < total };
    }
    if (!thread.externalConversationId) throw new BadRequestException('Fil de messages incomplet');
    const where = { externalConversationId: thread.externalConversationId };
    const [data, total] = await Promise.all([
      this.prisma.externalMessage.findMany({
        where, orderBy: [{ providerCreatedAt: 'desc' }, { createdAt: 'desc' }],
        include: { attachments: true },
        skip: (currentPage - 1) * pageSize, take: pageSize,
      }),
      this.prisma.externalMessage.count({ where }),
    ]);
    return { data, total, page: currentPage, limit: pageSize, hasMore: currentPage * pageSize < total };
  }

  async setMemberPermission(userId: string, memberUserId: string, dto: InboxMemberPermissionDto) {
    const user = await this.getProfessional(userId);
    if (user.role !== Role.user_salon && user.role !== Role.user) {
      throw new ForbiddenException('Seul un compte salon peut gérer les accès');
    }
    const member = await this.getProfessional(memberUserId);
    if (member.role !== Role.user_tatoueur || member.salonId !== userId) {
      throw new BadRequestException('Le tatoueur doit être lié au salon');
    }
    if (!dto.canView && (dto.canReply || dto.canAssign)) {
      throw new BadRequestException('La réponse et la délégation nécessitent le droit de consultation');
    }
    return this.prisma.inboxMemberPermission.upsert({
      where: { salonId_memberUserId: { salonId: userId, memberUserId } },
      update: { canView: dto.canView, canReply: dto.canReply, canAssign: dto.canAssign },
      create: { salonId: userId, memberUserId, canView: dto.canView, canReply: dto.canReply, canAssign: dto.canAssign },
    });
  }

  async assignThread(userId: string, threadId: string, dto: AssignInboxThreadDto) {
    const thread = await this.assertAccess(userId, threadId, 'owner');
    if (dto.assignedUserId && dto.assignedTatoueurId) {
      throw new BadRequestException('Choisissez un seul tatoueur');
    }
    if (dto.assignedUserId) {
      const member = await this.getProfessional(dto.assignedUserId);
      if (member.role !== Role.user_tatoueur || member.salonId !== thread.ownerUserId) {
        throw new BadRequestException('Ce tatoueur indépendant ne fait pas partie du salon');
      }
      const permission = await this.permission(thread.ownerUserId, member.id);
      if (!permission?.canView || !permission.canReply) {
        throw new BadRequestException('Autorisez d’abord ce tatoueur à consulter et répondre');
      }
    }
    if (dto.assignedTatoueurId) {
      const internalArtist = await this.prisma.tatoueur.findUnique({ where: { id: dto.assignedTatoueurId } });
      if (!internalArtist || internalArtist.userId !== thread.ownerUserId) {
        throw new BadRequestException('Ce tatoueur interne ne fait pas partie du salon');
      }
    }
    return this.prisma.inboxThread.update({
      where: { id: threadId },
      data: {
        assignedUserId: dto.assignedUserId || null,
        assignedTatoueurId: dto.assignedTatoueurId || null,
        assignedByUserId: userId,
        assignedAt: dto.assignedUserId || dto.assignedTatoueurId ? new Date() : null,
      },
    });
  }

  async setStatus(userId: string, threadId: string, status: InboxThreadStatus) {
    await this.assertAccess(userId, threadId, 'reply');
    return this.prisma.inboxThread.update({ where: { id: threadId }, data: { status } });
  }

  /**
   * Association volontaire : ne jamais déduire l'identité d'un client externe
   * à partir d'un pseudo Instagram ou d'un email sans confirmation humaine.
   */
  async linkClient(userId: string, threadId: string, clientId: string) {
    const thread = await this.assertAccess(userId, threadId, 'reply');
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Fiche client introuvable');
    if (client.userId !== thread.ownerUserId) {
      throw new ForbiddenException('Fiche client appartenant à un autre professionnel');
    }
    if (
      thread.channel === InboxChannel.INKERA && thread.conversation &&
      client.linkedUserId && client.linkedUserId !== thread.conversation.clientUserId
    ) {
      throw new BadRequestException('Cette fiche est déjà liée à un autre compte client Inkera');
    }
    return this.prisma.inboxThread.update({
      where: { id: thread.id }, data: { linkedClientId: client.id },
    });
  }

  /** Retire seulement le lien CRM du fil ; conserve la fiche et son historique. */
  async unlinkClient(userId: string, threadId: string) {
    const thread = await this.assertAccess(userId, threadId, 'reply');
    return this.prisma.inboxThread.update({
      where: { id: thread.id }, data: { linkedClientId: null },
    });
  }

  /** RDV du client (fiche CRM et/ou compte Inkera), toujours restreints au professionnel propriétaire. */
  async listAppointments(userId: string, threadId: string, page = 1, limit = 5) {
    const thread = await this.assertAccess(userId, threadId);
    const identities: Prisma.AppointmentWhereInput[] = [];
    if (thread.linkedClientId) identities.push({ clientId: thread.linkedClientId });
    if (thread.conversation?.clientUserId) identities.push({ clientUserId: thread.conversation.clientUserId });

    const currentPage = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(5, Math.max(1, Number(limit) || 5));
    if (!identities.length) {
      return { data: [], total: 0, page: currentPage, limit: pageSize, totalPages: 0 };
    }
    const where: Prisma.AppointmentWhereInput = {
      userId: thread.ownerUserId,
      OR: identities,
    };
    const [data, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        select: {
          id: true, title: true, prestation: true, start: true, end: true,
          status: true, clientId: true,
          client: { select: { firstName: true, lastName: true } },
          clientUser: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ start: 'desc' }, { id: 'desc' }],
        skip: (currentPage - 1) * pageSize, take: pageSize,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { data, total, page: currentPage, limit: pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async createAndLinkClient(userId: string, threadId: string, dto: CreateInboxClientDto) {
    const thread = await this.assertAccess(userId, threadId, 'reply');
    const email = dto.email.trim().toLowerCase();
    // L'email n'est utilisé que pour réutiliser une fiche existante au sein
    // du même espace CRM. Aucune conversation externe n'est fusionnée.
    let client = await this.prisma.client.findFirst({
      where: { userId: thread.ownerUserId, email },
    });
    if (!client) {
      client = await this.prisma.client.create({
        data: {
          userId: thread.ownerUserId, firstName: dto.firstName.trim(), lastName: dto.lastName.trim(),
          email, phone: dto.phone.trim(), tags: [],
        },
      });
    }
    await this.linkClient(userId, threadId, client.id);
    return client;
  }

  async linkAppointment(userId: string, threadId: string, appointmentId: string) {
    const thread = await this.assertAccess(userId, threadId, 'reply');
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException('Rendez-vous introuvable');
    if (appointment.userId !== thread.ownerUserId) {
      throw new ForbiddenException('Ce rendez-vous appartient à un autre professionnel');
    }
    if (thread.linkedClientId && appointment.clientId && thread.linkedClientId !== appointment.clientId) {
      throw new BadRequestException('Le rendez-vous est associé à une autre fiche client');
    }
    const threadInkeraUserId = thread.conversation?.clientUserId;
    if (threadInkeraUserId && appointment.clientUserId && threadInkeraUserId !== appointment.clientUserId) {
      throw new BadRequestException('Le rendez-vous est associé à un autre compte client Inkera');
    }
    if (!threadInkeraUserId && !thread.linkedClientId) {
      throw new BadRequestException('Associez d’abord une fiche client à la conversation externe');
    }
    if (thread.linkedClientId && !threadInkeraUserId && appointment.clientId !== thread.linkedClientId) {
      throw new BadRequestException('Ce rendez-vous ne correspond pas à la fiche client');
    }
    if (threadInkeraUserId && !appointment.clientUserId && appointment.clientId) {
      const client = await this.prisma.client.findUnique({ where: { id: appointment.clientId } });
      if (!client || client.linkedUserId !== threadInkeraUserId) {
        throw new BadRequestException('Impossible de vérifier le client de ce rendez-vous');
      }
    }
    if (threadInkeraUserId && !appointment.clientUserId && !appointment.clientId) {
      throw new BadRequestException('Rendez-vous sans client vérifiable');
    }
    return this.prisma.inboxThreadAppointment.upsert({
      where: { inboxThreadId_appointmentId: { inboxThreadId: thread.id, appointmentId } },
      update: {}, create: { inboxThreadId: thread.id, appointmentId },
    });
  }

  async listNotes(userId: string, threadId: string) {
    await this.assertAccess(userId, threadId);
    return this.prisma.inboxInternalNote.findMany({
      where: { inboxThreadId: threadId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async addNote(userId: string, threadId: string, content: string) {
    await this.assertAccess(userId, threadId, 'reply');
    const trimmed = content?.trim();
    if (!trimmed) throw new BadRequestException('Une note ne peut pas être vide');
    return this.prisma.inboxInternalNote.create({
      data: { inboxThreadId: threadId, authorUserId: userId, content: trimmed },
    });
  }

  async setReadState(userId: string, threadId: string, forceUnread: boolean) {
    const thread = await this.assertAccess(userId, threadId);
    const result = await this.prisma.inboxReadState.upsert({
      where: { inboxThreadId_userId: { inboxThreadId: threadId, userId } },
      update: forceUnread ? { forceUnread: true } : { forceUnread: false, lastReadAt: new Date() },
      create: { inboxThreadId: threadId, userId, forceUnread, lastReadAt: forceUnread ? null : new Date() },
    });
    // Pour le propriétaire, la notification navbar historique est la source de vérité.
    // Un tatoueur assigné gère seulement sa lecture personnelle.
    if (!forceUnread && thread.conversationId && thread.ownerUserId === userId) {
      await this.prisma.message.updateMany({
        where: { conversationId: thread.conversationId, senderId: { not: userId }, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });
      await this.notification.resetUnreadCount(thread.conversationId, userId);
      if (this.gateway) {
        this.gateway.notifyUser(userId, 'unread-count-updated', {
          totalUnread: await this.notification.getTotalUnreadCount(userId),
        });
      }
    }
    return result;
  }

  async listSavedReplies(userId: string) {
    const user = await this.getProfessional(userId);
    const owners = [user.id];
    if (user.role === Role.user_tatoueur && user.salonId) {
      const permission = await this.permission(user.salonId, user.id);
      if (permission?.canView) owners.push(user.salonId);
    }
    return this.prisma.savedReply.findMany({
      where: { ownerUserId: { in: owners }, isActive: true },
      orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createSavedReply(userId: string, dto: SaveInboxReplyDto) {
    await this.getProfessional(userId);
    return this.prisma.savedReply.create({
      data: {
        ownerUserId: userId, createdByUserId: userId,
        title: dto.title.trim(), content: dto.content.trim(), channel: dto.channel ?? null,
      },
    });
  }

  /**
   * Envoi depuis l'Inbox : les indépendants assignés n'utilisent PAS la route
   * historique (réservée au salon et au client), mais le même modèle Message.
   */
  async sendReply(userId: string, threadId: string, dto: InboxReplyDto) {
    const thread = await this.assertAccess(userId, threadId, 'reply');
    if (thread.channel === InboxChannel.INSTAGRAM) {
      if (!this.instagram) throw new BadRequestException('Connecteur Instagram indisponible');
      return this.instagram.sendReply(userId, thread, dto);
    }
    if (thread.channel !== InboxChannel.INKERA || !thread.conversationId || !thread.conversation) {
      throw new BadRequestException('Envoi externe indisponible : connecteur non configuré');
    }
    const content = dto.content?.trim();
    if (!content) throw new BadRequestException('Le message ne peut pas être vide');

    const message = await this.prisma.message.create({
      data: {
        conversationId: thread.conversationId,
        senderId: userId,
        content,
        type: MessageType.TEXT,
        attachments: dto.attachments?.length ? {
          create: dto.attachments.map((attachment) => ({
            fileName: attachment.fileName, fileUrl: attachment.fileUrl,
            fileType: attachment.fileType, fileSize: attachment.fileSize,
            uploadThingKey: attachment.uploadThingKey,
          })),
        } : undefined,
      },
      include: {
        attachments: true,
        sender: { select: { id: true, firstName: true, lastName: true, salonName: true, image: true } },
      },
    });
    const now = new Date();
    await Promise.all([
      this.prisma.conversation.update({ where: { id: thread.conversationId }, data: { lastMessageAt: now } }),
      this.prisma.inboxThread.update({ where: { id: thread.id }, data: { lastMessageAt: now } }),
    ]);
    await this.notification.incrementUnreadCount(thread.conversationId, thread.conversation.clientUserId);
    if (this.gateway) {
      this.gateway.notifyConversation(thread.conversationId, 'new-message', message);
      this.gateway.notifyUser(thread.conversation.clientUserId, 'unread-count-updated', {
        totalUnread: await this.notification.getTotalUnreadCount(thread.conversation.clientUserId),
      });
      this.gateway.notifyUser(thread.ownerUserId, 'inbox-message-updated', { threadId: thread.id });
      if (thread.assignedUserId && thread.assignedUserId !== thread.ownerUserId) {
        this.gateway.notifyUser(thread.assignedUserId, 'inbox-message-updated', { threadId: thread.id });
      }
    }
    return message;
  }
}
