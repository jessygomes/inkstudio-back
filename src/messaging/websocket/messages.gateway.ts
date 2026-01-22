import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RedisOnlineStatusService } from '../../redis/redis-online-status.service';
import { WebSocketAuthService } from './websocket-auth.service';
import {
  CreateMessagePayload,
  MarkAsReadPayload,
  MarkConversationAsReadPayload,
  JoinConversationPayload,
  LeaveConversationPayload,
  UserTypingPayload,
  UserStoppedTypingPayload,
  NewMessageEvent,
  MessageReadEvent,
  UserTypingEvent,
  UserStoppedTypingEvent,
  UserOnlineEvent,
  UserOfflineEvent,
  UnreadCountUpdatedEvent,
} from './message-events';

// Gateway Socket.IO dédié aux conversations temps réel
@WebSocketGateway({
  namespace: '/messaging',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  serveClient: false,
  // Message compression pour réduire la bande passante
  // Compresse les payloads > 1KB avec gzip (40-60% reduction)
  perMessageDeflate: {
    threshold: 1024, // Compress payloads > 1KB
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    serverMaxWindowBits: 15,
    clientMaxWindowBits: 15,
  },
})
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger('MessagesGateway');

  @WebSocketServer()
  server: Server;

  // Mapping de userId → Set de socket.id (un utilisateur peut avoir plusieurs onglets ouverts)
  private userConnections: Map<string, Set<string>> = new Map(); // permet les multi-onglets

  // Mapping de socket.id → userId
  private socketUserMap: Map<string, string> = new Map();

  // Tracking des utilisateurs en train de taper
  private typingUsers: Map<string, Set<string>> = new Map(); // conversationId → Set<userId>

  constructor(
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private notificationService: MessageNotificationService,
    private emailNotificationService: EmailNotificationService,
    private prisma: PrismaService,
    private redisService: RedisService,
    private redisOnlineStatusService: RedisOnlineStatusService,
    private webSocketAuthService: WebSocketAuthService,
  ) {}

  /**
   * Obtenir un message d'erreur à partir d'une valeur inconnue
   */
  // Normalise une valeur inconnue en message lisible (évite les accès dangereux sur Error)
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Une erreur inconnue s\'est produite';
  }

  /**
   * Initialisation du gateway avec Redis adapter
   */
  afterInit(server: Server): void {
    try {
      // Configure Redis adapter pour Socket.IO (permet le scaling horizontal)
      const pubClient = this.redisService.getPubClient();
      const subClient = this.redisService.getSubClient();

      server.adapter(createAdapter(pubClient, subClient));
      this.logger.log('Redis adapter configured for Socket.IO');
      this.logger.log('MessagesGateway initialized with horizontal scaling support');
    } catch (error) {
      this.logger.error(
        'Failed to setup Redis adapter:',
        this.getErrorMessage(error),
      );
      // Continue sans Redis pour le dev local
      this.logger.warn('Continuing without Redis adapter - using in-memory adapter');
    }
  }

  /**
   * Gestion de la connexion d'un client
   */
  async handleConnection(client: Socket) {
    try {
      // Extraire le userId du token JWT
      const token = (client.handshake?.auth?.token as string | undefined);
      if (!token) {
        this.logger.warn('Client connecté sans token, déconnexion');
        client.disconnect?.();
        return;
      }

      // Valider le token et extraire le userId
      const userId = this.webSocketAuthService.validateToken(token);
      if (!userId) {
        this.logger.warn('Token invalide, déconnexion');
        client.disconnect?.();
        return;
      }

      // Enregistrer la connexion en mémoire
      this.socketUserMap.set(client.id, userId);

      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(client.id);

      // Enregistrer en Redis pour le scaling horizontal
      // Purge agressive: on remplace toutes les connexions par la connexion courante.
      // TODO: passer sur heartbeat + nettoyage ciblé pour réactiver le multi-onglets (option 2/3).
      void this.redisOnlineStatusService.resetUserConnections(userId, client.id);

      this.logger.log(
        `Client ${client.id} connecté - User ${userId}`,
      );

      // Récupérer les infos de l'utilisateur pour la notification
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, salonName: true },
      });

      if (user) {
        const userName = user.salonName || `${user.firstName} ${user.lastName}`;

        // Broadcaster que l'utilisateur est en ligne
        this.server.emit('user-online', {
          userId,
          userName,
        } as UserOnlineEvent);
      }

      // Envoyer le compteur de messages non lus
      const unreadCount =
        await this.notificationService.getTotalUnreadCount(userId);
      client.emit('unread-count-updated', {
        totalUnread: unreadCount,
      } as UnreadCountUpdatedEvent);
    } catch (error: unknown) {
      this.logger.error('Erreur lors de la connexion:', this.getErrorMessage(error));
      if (client) {
        client.disconnect?.();
      }
    }
  }

  /**
   * Gestion de la déconnexion d'un client
   */
  handleDisconnect(client: Socket) {
    try {
      const userId = this.socketUserMap.get(client.id);
      if (!userId) return;

      // Supprimer la connexion
      this.socketUserMap.delete(client.id);

      const connections = this.userConnections.get(userId);
      if (connections) {
        connections.delete(client.id);

        // Mettre à jour Redis et vérifier si user est complètement offline
        void this.redisOnlineStatusService.removeUserConnection(userId, client.id).then(
          (isFullyOffline) => {
            // Si c'était la dernière connexion de cet utilisateur
            if (isFullyOffline) {
              this.userConnections.delete(userId);

              // Broadcaster que l'utilisateur est hors ligne
              this.server.emit('user-offline', {
                userId,
              } as UserOfflineEvent);

              this.logger.log(`User ${userId} complètement déconnecté`);
            }
          },
        );
      }

      this.logger.log(`Client ${client.id} déconnecté - User ${userId}`);
    } catch (error: unknown) {
      this.logger.error('Erreur lors de la déconnexion:', this.getErrorMessage(error));
    }
  }

  /**
   * Événement : Rejoindre une conversation
   */
  @SubscribeMessage('join-conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinConversationPayload,
  ) {
    try {
      const userId = this.socketUserMap.get(client.id);
      if (!userId) {
        client.emit?.('error', { message: 'Non authentifié' });
        return;
      }

      const { conversationId } = payload;

      // Vérifier que l'utilisateur a accès à cette conversation
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, salonId: true, clientUserId: true },
      });

      if (!conversation) {
        client.emit?.('error', { message: 'Conversation non trouvée' });
        return;
      }

      if (
        conversation.salonId !== userId &&
        conversation.clientUserId !== userId
      ) {
        client.emit?.('error', { message: 'Accès refusé à cette conversation' });
        return;
      }

      // Rejoindre la room Socket.IO
      void client.join?.(`conversation-${conversationId}`); // void pour signaler l'appel fire-and-forget

      this.logger.log(
        `User ${userId} a rejoint la conversation ${conversationId}`,
      );

      // Envoyer les messages récents (optionnel - pour l'historique)
      try {
        const messagesResponse = await this.messagesService.getMessages(
          conversationId,
          userId,
          1,
          50,
        );

        client.emit?.('conversation-history', {
          conversationId,
          messages: messagesResponse.data,
        });
      } catch (error: unknown) {
        this.logger.error('Erreur lors du chargement de l\'historique:', this.getErrorMessage(error));
      }

      // Notifier que l'utilisateur a rejoint
      void this.server.to(`conversation-${conversationId}`).emit('user-joined', { // notification room
        userId,
        conversationId,
      });
    } catch (error: unknown) {
      this.logger.error('Erreur handleJoinConversation:', this.getErrorMessage(error));
      if (client?.emit) {
        client.emit('error', {
          message: 'Erreur lors de la connexion à la conversation',
        });
      }
    }
  }

  /**
   * Événement : Quitter une conversation
   */
  @SubscribeMessage('leave-conversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LeaveConversationPayload,
  ) {
    try {
      const userId = this.socketUserMap.get(client.id);
      if (!userId) return;

      const { conversationId } = payload;

      // Marquer tous les messages de la conversation comme lus avant de quitter
      await this.conversationsService.markAllAsRead(conversationId, userId);

      // Mettre à jour le compteur global de notifications
      const unreadCount =
        await this.notificationService.getTotalUnreadCount(userId);

      client.emit?.('unread-count-updated', {
        totalUnread: unreadCount,
      } as UnreadCountUpdatedEvent);

      // Quitter la room
      void client.leave?.(`conversation-${conversationId}`);

      // Arrêter le typing indicator si l'utilisateur était en train de taper
      const typingKey = `typing-${conversationId}`;
      const typingSet = this.typingUsers.get(typingKey);
      if (typingSet) {
        typingSet.delete(userId);
      }

      this.logger.log(
        `User ${userId} a quitté la conversation ${conversationId}`,
      );
    } catch (error: unknown) {
      this.logger.error('Erreur handleLeaveConversation:', this.getErrorMessage(error));
    }
  }

  /**
   * Événement : Envoyer un message
   */
  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateMessagePayload,
  ) {
    try {
      const userId = this.socketUserMap.get(client.id);
      if (!userId) {
        client.emit?.('error', { message: 'Non authentifié' });
        return;
      }

      const { conversationId, content, attachments } = payload;

      // Valider que l'utilisateur a accès à cette conversation
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, salonId: true, clientUserId: true },
      });

      if (!conversation) {
        client.emit?.('error', { message: 'Conversation non trouvée' });
        return;
      }

      if (
        conversation.salonId !== userId &&
        conversation.clientUserId !== userId
      ) {
        client.emit?.('error', { message: 'Accès refusé à cette conversation' });
        return;
      }

      // Créer le message via le service
      const message = await this.messagesService.sendMessage(userId, {
        conversationId,
        content,
        attachments,
      });

      // Vérifier si le destinataire est présent dans la conversation
      const otherUserId =
        conversation.salonId === userId
          ? conversation.clientUserId
          : conversation.salonId;

      this.logger.log(`👥 [User Debug] Sender: ${userId}, Recipient: ${otherUserId}, ConversationId: ${conversationId}`);
      this.logger.log(`👥 [User Debug] Conversation - salonId: ${conversation.salonId}, clientUserId: ${conversation.clientUserId}`);

      const otherUserSockets = this.userConnections.get(otherUserId) || new Set();
      let isRecipientInRoom = false;

      if (this.server?.sockets?.sockets) {
        for (const socketId of otherUserSockets) {
          const socket = this.server.sockets.sockets.get(socketId);
          if (socket && socket.rooms.has(`conversation-${conversationId}`)) {
            isRecipientInRoom = true;
            break;
          }
        }
      }

      // Si le destinataire est dans la room, marquer le message comme lu automatiquement
      let messageToSend = message;
      if (isRecipientInRoom) {
        const updatedMessage = await this.messagesService.markAsRead(message.id, otherUserId);
        messageToSend = updatedMessage;
        // Décrémenter le compteur de non-lus puisque le message a été lu immédiatement
        await this.notificationService.resetUnreadCount(conversationId, otherUserId);
        
        // Envoyer un événement pour notifier que la conversation n'a plus de non-lus
        this.notifyUser(otherUserId, 'conversation-unread-updated', {
          conversationId,
          unreadCount: 0,
        });
      }

      // Broadcaster le nouveau message à tous les clients de la conversation
      this.server
        .to(`conversation-${conversationId}`)
        .emit('new-message', messageToSend as NewMessageEvent);

      // Mettre à jour le compteur de messages non lus pour les autres participants
      const unreadCount =
        await this.notificationService.getTotalUnreadCount(otherUserId);

      // Envoyer le notification seulement aux connexions de l'autre utilisateur
      const otherUserConnections = this.userConnections.get(otherUserId);
      if (otherUserConnections && this.server?.sockets?.sockets) {
        otherUserConnections.forEach((socketId) => {
          const socket = this.server.sockets.sockets.get(socketId);
          if (socket?.emit) {
            socket.emit('unread-count-updated', {
              totalUnread: unreadCount,
            } as UnreadCountUpdatedEvent);
          }
        });
      }

      // Arrêter le typing indicator
      const typingKey = `typing-${conversationId}`;
      const typingSet = this.typingUsers.get(typingKey);
      if (typingSet) {
        typingSet.delete(userId);
      }

      // Queuer une notification email si le destinataire n'est pas connecté
      // Check both in-memory cache et Redis pour accuracy
      let isRecipientOnline = this.userConnections.has(otherUserId);
      this.logger.log(`📊 [Email Debug] User ${otherUserId} - Local cache: ${isRecipientOnline}`);
      
      // If not online locally, check Redis (for multi-server deployments)
      if (!isRecipientOnline) {
        isRecipientOnline = await this.redisOnlineStatusService.isUserOnline(otherUserId);
        this.logger.log(`📊 [Email Debug] User ${otherUserId} - Redis check: ${isRecipientOnline}`);
      }

      if (!isRecipientOnline) {
        this.logger.log(`📧 [Email Debug] User ${otherUserId} is OFFLINE - checking if should send email...`);
        const shouldSendEmail = await this.emailNotificationService.shouldSendNotification(
          conversationId,
          otherUserId,
        );
        this.logger.log(`📧 [Email Debug] shouldSendEmail result: ${shouldSendEmail}`);
        if (shouldSendEmail) {
          await this.emailNotificationService.queueNotification(
            conversationId,
            otherUserId,
          );
          this.logger.log(
            `✅ Email notification queued for ${otherUserId} in conversation ${conversationId}`,
          );
        } else {
          this.logger.log(
            `⚠️ Email notification NOT queued for ${otherUserId} - preferences or rate limit`,
          );
        }
      } else {
        this.logger.log(`🟢 [Email Debug] User ${otherUserId} is ONLINE - no email needed`);
      }

      this.logger.log(
        `Message créé dans la conversation ${conversationId} par ${userId}`,
      );
    } catch (error: unknown) {
      this.logger.error('Erreur handleSendMessage:', this.getErrorMessage(error));
      if (client?.emit) {
        client.emit('error', {
          message: 'Erreur lors de l\'envoi du message',
        });
      }
    }
  }

  /**
   * Événement : Marquer un message comme lu
   */
  @SubscribeMessage('mark-as-read')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MarkAsReadPayload,
  ) {
    try {
      const userId = this.socketUserMap.get(client.id);
      if (!userId) {
        client.emit?.('error', { message: 'Non authentifié' });
        return;
      }

      const { messageId } = payload;

      // Marquer le message comme lu
      const message = await this.messagesService.markAsRead(messageId, userId);

      // Broadcaster à tous les clients de la conversation
      this.server
        .to(`conversation-${message.conversationId}`)
        .emit('message-read', {
          messageId,
          readAt: message.readAt,
        } as MessageReadEvent);

      // Mettre à jour le compteur de notifications
      const unreadCount =
        await this.notificationService.getTotalUnreadCount(userId);

      client.emit?.('unread-count-updated', {
        totalUnread: unreadCount,
      } as UnreadCountUpdatedEvent);

      this.logger.log(`Message ${messageId} marqué comme lu par ${userId}`);
    } catch (error: unknown) {
      this.logger.error('Erreur handleMarkAsRead:', this.getErrorMessage(error));
      if (client?.emit) {
        client.emit('error', {
          message: 'Erreur lors du marquage du message',
        });
      }
    }
  }

  /**
   * Événement : Marquer tous les messages d'une conversation comme lus
   */
  @SubscribeMessage('mark-conversation-as-read')
  async handleMarkConversationAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MarkConversationAsReadPayload,
  ) {
    try {
      const userId = this.socketUserMap.get(client.id);
      if (!userId) {
        client.emit?.('error', { message: 'Non authentifié' });
        return;
      }

      const { conversationId } = payload;

      // Marquer tous les messages de la conversation comme lus
      await this.conversationsService.markAllAsRead(conversationId, userId);

      // Mettre à jour le compteur de notifications
      const unreadCount =
        await this.notificationService.getTotalUnreadCount(userId);

      client.emit?.('unread-count-updated', {
        totalUnread: unreadCount,
      } as UnreadCountUpdatedEvent);

      this.logger.log(
        `Conversation ${conversationId} marquée comme lue par ${userId}`,
      );
    } catch (error: unknown) {
      this.logger.error('Erreur handleMarkConversationAsRead:', this.getErrorMessage(error));
      if (client?.emit) {
        client.emit('error', {
          message: 'Erreur lors du marquage de la conversation',
        });
      }
    }
  }

  /**
   * Événement : Utilisateur en train d'écrire (typing indicator)
   */
  @SubscribeMessage('user-typing')
  async handleUserTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UserTypingPayload,
  ) {
    try {
      if (!client?.id) {
        return;
      }

      const userId = this.socketUserMap.get(client.id);
      if (!userId) return;

      const { conversationId } = payload;

      // Ajouter l'utilisateur à la liste des gens qui tapent
      const typingKey = `typing-${conversationId}`;
      if (!this.typingUsers.has(typingKey)) {
        this.typingUsers.set(typingKey, new Set());
      }
      this.typingUsers.get(typingKey)?.add(userId);

      // Récupérer les infos de l'utilisateur
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, salonName: true },
      });

      const userName = user
        ? user.salonName || `${user.firstName} ${user.lastName}`
        : 'Utilisateur';

      // Broadcaster aux autres clients de la conversation
      client.broadcast
        ?.to?.(`conversation-${conversationId}`)
        ?.emit?.('user-typing', {
          conversationId,
          userId,
          userName,
        } as UserTypingEvent);
    } catch (error: unknown) {
      this.logger.error('Erreur handleUserTyping:', this.getErrorMessage(error));
    }
  }

  /**
   * Événement : Utilisateur arrête d'écrire
   */
  @SubscribeMessage('user-stopped-typing')
  handleUserStoppedTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UserStoppedTypingPayload,
  ) {
    try {
      if (!client?.id) {
        return;
      }

      const userId = this.socketUserMap.get(client.id);
      if (!userId) return;

      const { conversationId } = payload;

      // Retirer l'utilisateur de la liste des gens qui tapent
      const typingKey = `typing-${conversationId}`;
      const typingSet = this.typingUsers.get(typingKey);
      if (typingSet) {
        typingSet.delete(userId);
        if (typingSet.size === 0) {
          this.typingUsers.delete(typingKey);
        }
      }

      // Broadcaster aux autres clients
      client.broadcast
        ?.to?.(`conversation-${conversationId}`)
        ?.emit?.('user-stopped-typing', {
          conversationId,
          userId,
        } as UserStoppedTypingEvent);
    } catch (error: unknown) {
      this.logger.error('Erreur handleUserStoppedTyping:', this.getErrorMessage(error));
    }
  }

  /**
   * Envoyer une notification à un utilisateur spécifique
   */
  notifyUser(userId: string, event: string, data: any) {
    const connections = this.userConnections.get(userId);
    if (connections) {
      connections.forEach((socketId) => {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(event, data);
        }
      });
    }
  }

  /**
   * Envoyer une notification à une conversation spécifique
   */
  notifyConversation(conversationId: string, event: string, data: any): void {
    void this.server.to(`conversation-${conversationId}`).emit(event, data);
  }
}
