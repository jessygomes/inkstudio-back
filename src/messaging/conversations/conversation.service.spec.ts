import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../../database/prisma.service';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { ConversationStatus, MessageType } from '@prisma/client';

const createPrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
  appointment: {
    findUnique: jest.fn(),
  },
  conversation: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  message: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  messageNotification: {
    upsert: jest.fn(),
    aggregate: jest.fn(),
    findUnique: jest.fn(),
  },
});

const createNotificationMock = () => ({
  incrementUnreadCount: jest.fn().mockResolvedValue(undefined),
  resetUnreadCount: jest.fn().mockResolvedValue(undefined),
  getUnreadCount: jest.fn().mockResolvedValue(0),
});

const buildUser = (overrides?: Partial<any>) => ({
  id: 'user-1',
  role: 'client',
  email: 'client@test.com',
  firstName: 'John',
  lastName: 'Doe',
  image: null,
  salonName: null,
  ...overrides,
});

const buildConversation = (overrides?: Partial<any>) => ({
  id: 'conv-1',
  salonId: 'salon-1',
  clientUserId: 'client-1',
  appointmentId: null,
  subject: 'Sujet',
  status: ConversationStatus.ACTIVE,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  lastMessageAt: new Date('2026-01-03'),
  salon: buildUser({ id: 'salon-1', role: 'salon', salonName: 'Ink' }),
  clientUser: buildUser({ id: 'client-1', role: 'client' }),
  messages: [],
  ...overrides,
});

const buildMessage = (overrides?: Partial<any>) => ({
  id: 'msg-1',
  content: 'Hello',
  senderId: 'salon-1',
  type: MessageType.SYSTEM,
  createdAt: new Date('2026-01-04'),
  ...overrides,
});

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let notifications: ReturnType<typeof createNotificationMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    notifications = createNotificationMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessageNotificationService, useValue: notifications },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createConversation', () => {
    it('throws when client not found', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const dto = { clientUserId: 'missing', subject: 'Hi' };

      await expect(
        service.createConversation('salon-1', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when user is not client', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        buildUser({ role: 'salon' }),
      );
      const dto = { clientUserId: 'client-1', subject: 'Hi' };

      await expect(
        service.createConversation('salon-1', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when salon not found', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(null);
      const dto = { clientUserId: 'client-1', subject: 'Hi' };

      await expect(
        service.createConversation('salon-1', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns existing conversation when appointment already linked', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(buildUser({ id: 'salon-1', role: 'salon' }));
      prisma.appointment.findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'app-1' });
      const existing = buildConversation({ appointmentId: 'app-1' });
      prisma.conversation.findUnique.mockResolvedValue(existing);

      const result = await service.createConversation('salon-1', {
        clientUserId: 'client-1',
        appointmentId: 'app-1',
      });

      expect(result.id).toBe(existing.id);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('creates conversation and first message with unread increment', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(buildUser({ id: 'salon-1', role: 'salon' }));
      prisma.conversation.create.mockResolvedValue(buildConversation());

      const result = await service.createConversation('salon-1', {
        clientUserId: 'client-1',
        firstMessage: 'Hello',
        subject: 'Sujet',
      });

      expect(result.id).toBe('conv-1');
      expect(prisma.conversation.create).toHaveBeenCalled();
      const [[createCall]] = prisma.message.create.mock.calls as Array<
        [{ data?: { content?: string } }]
      >;
      expect(createCall.data?.content).toBe('Hello');
      expect(notifications.incrementUnreadCount).toHaveBeenCalledWith(
        expect.any(String),
        'client-1',
      );
    });

    it('creates conversation without first message when none provided', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(buildUser({ id: 'salon-1', role: 'salon' }));
      prisma.conversation.create.mockResolvedValue(buildConversation());

      await service.createConversation('salon-1', {
        clientUserId: 'client-1',
      });

      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(notifications.incrementUnreadCount).not.toHaveBeenCalled();
    });
  });

  describe('getConversations', () => {
    it('returns paginated conversations mapped', async () => {
      const conv1 = buildConversation({ id: 'c1' });
      const conv2 = buildConversation({ id: 'c2' });
      prisma.conversation.findMany.mockResolvedValue([conv1, conv2]);
      prisma.conversation.count.mockResolvedValue(2);
      const result = await service.getConversations('salon-1', 1, 10);

      expect(result.total).toBe(2);
      expect(result.data.map((d) => d.id)).toEqual(['c1', 'c2']);
      const [[findManyCall]] = prisma.conversation.findMany.mock.calls as Array<
        [
          {
            where?: { OR?: Array<{ salonId?: string, clientUserId?: string }> },
            skip?: number,
            take?: number,
          }
        ]
      >;
      expect(findManyCall.where?.OR).toEqual([
        { salonId: 'salon-1' },
        { clientUserId: 'salon-1' },
      ]);
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(10);
    });
  });

  describe('getConversationsWithUnreadMessages', () => {
    it('returns mapped unread conversations with counts', async () => {
      const lastMessage = buildMessage({ senderId: 'client-1', isRead: false });
      const conv = buildConversation({
        id: 'conv-1',
        messages: [lastMessage],
        clientUser: buildUser({
          id: 'client-1',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      });

      prisma.conversation.findMany.mockResolvedValue([conv]);
      notifications.getUnreadCount.mockResolvedValue(3);

      const result =
        await service.getConversationsWithUnreadMessages('salon-1');

      expect(result).toHaveLength(1);
      expect(result[0].conversationId).toBe('conv-1');
      expect(result[0].clientId).toBe('client-1');
      expect(result[0].unreadCount).toBe(3);
      expect(result[0].lastMessage.id).toBe('msg-1');
      const [[findManyCall]] = prisma.conversation.findMany.mock.calls as Array<
        [
          {
            where?: {
              salonId?: string,
              status?: ConversationStatus,
              messages?: any,
            },
            take?: number,
            orderBy?: { lastMessageAt?: 'desc' },
          }
        ]
      >;
      expect(findManyCall.where?.salonId).toBe('salon-1');
      expect(findManyCall.take).toBe(10);
    });
  });

  describe('getConversationById', () => {
    it('throws when not found', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.getConversationById('conv-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when user not participant', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ salonId: 'other', clientUserId: 'other' }),
      );

      await expect(
        service.getConversationById('conv-1', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('marks as read and maps response', async () => {
      prisma.conversation.findUnique.mockResolvedValue(buildConversation());
      const result = await service.getConversationById('conv-1', 'client-1');

      expect(prisma.message.updateMany).toHaveBeenCalled();
      expect(result.id).toBe('conv-1');
    });
  });

  describe('updateConversation', () => {
    it('throws when not found', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.updateConversation('conv-1', 'user-1', { subject: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when forbidden', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ salonId: 'other', clientUserId: 'other' }),
      );

      await expect(
        service.updateConversation('conv-1', 'user-1', { subject: 'New' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('updates and maps conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue(buildConversation());
      prisma.conversation.update.mockResolvedValue(
        buildConversation({ subject: 'New' }),
      );

      const result = await service.updateConversation('conv-1', 'client-1', {
        subject: 'New',
      });

      expect(prisma.conversation.update).toHaveBeenCalled();
      expect(result.subject).toBe('New');
    });
  });

  describe('archiveConversation', () => {
    it('throws when not found', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.archiveConversation('conv-1', 'salon-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when user not salon', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ salonId: 'other' }),
      );

      await expect(
        service.archiveConversation('conv-1', 'salon-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('toggles status between active and archived', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ status: ConversationStatus.ACTIVE }),
      );
      prisma.conversation.update.mockResolvedValue(
        buildConversation({ status: ConversationStatus.ARCHIVED }),
      );

      await service.archiveConversation('conv-1', 'salon-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { status: ConversationStatus.ARCHIVED },
      });
    });
  });

  describe('deleteConversation', () => {
    it('throws when not found', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteConversation('conv-1', 'salon-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when user not salon', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        buildConversation({ salonId: 'other' }),
      );

      await expect(
        service.deleteConversation('conv-1', 'salon-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('deletes when authorized', async () => {
      prisma.conversation.findUnique.mockResolvedValue(buildConversation());

      await service.deleteConversation('conv-1', 'salon-1');

      expect(prisma.conversation.delete).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
      });
    });
  });

  describe('markAllAsRead', () => {
    it('updates unread messages and resets counts', async () => {
      prisma.message.updateMany.mockResolvedValue({});
      notifications.resetUnreadCount.mockResolvedValue(undefined);

      await service.markAllAsRead('conv-1', 'user-1');

      const [[updateCall]] = prisma.message.updateMany.mock.calls as Array<
        [
          {
            where?: {
              conversationId?: string,
              senderId?: { not?: string },
              isRead?: boolean,
            },
            data?: { isRead?: boolean, readAt?: Date },
          }
        ]
      >;
      expect(updateCall?.where).toEqual({
        conversationId: 'conv-1',
        senderId: { not: 'user-1' },
        isRead: false,
      });
      expect(updateCall?.data?.isRead).toBe(true);
      expect(updateCall?.data?.readAt).toBeInstanceOf(Date);
      expect(notifications.resetUnreadCount).toHaveBeenCalledWith(
        'conv-1',
        'user-1',
      );
    });
  });
});
