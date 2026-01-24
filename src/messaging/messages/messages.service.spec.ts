/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../database/prisma.service';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { MessageType } from '@prisma/client';

// Mock factory
const createPrismaMock = () => ({
  message: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  conversation: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  emailNotificationQueue: {
    deleteMany: jest.fn(),
  },
});

const createNotificationServiceMock = () => ({
  incrementUnreadCount: jest.fn().mockResolvedValue(undefined),
  resetUnreadCount: jest.fn().mockResolvedValue(undefined),
});

// Test data builders
const buildMessage = (overrides?: Partial<any>) => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  senderId: 'sender-1',
  content: 'Hello',
  type: MessageType.TEXT,
  isRead: false,
  readAt: null,
  createdAt: new Date('2026-01-01'),
  sender: {
    id: 'sender-1',
    firstName: 'Jean',
    lastName: 'Dupont',
    salonName: null,
    image: null,
    role: 'CLIENT',
  },
  attachments: [],
  ...overrides,
});

const buildConversation = (overrides?: Partial<any>) => ({
  id: 'conv-1',
  salonId: 'salon-1',
  clientUserId: 'client-1',
  lastMessageAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

const buildAttachment = (overrides?: Partial<any>) => ({
  id: 'att-1',
  messageId: 'msg-1',
  fileName: 'document.pdf',
  fileUrl: 'https://example.com/file.pdf',
  fileType: 'application/pdf',
  fileSize: 1024,
  uploadThingKey: 'uploadthing-key',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let notificationService: ReturnType<typeof createNotificationServiceMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    notificationService = createNotificationServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: MessageNotificationService,
          useValue: notificationService,
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should send a new message with content', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Hello world',
        type: MessageType.TEXT,
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage({
        content: 'Hello world',
      });

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);
      prisma.conversation.update.mockResolvedValue(mockConversation);

      const result = await service.sendMessage('salon-1', dto);

      expect(result).toEqual(
        expect.objectContaining({
          id: 'msg-1',
          content: 'Hello world',
          conversationId: 'conv-1',
        }),
      );
      expect(prisma.message.create).toHaveBeenCalled();
      expect(notificationService.incrementUnreadCount).toHaveBeenCalledWith(
        'conv-1',
        'client-1',
      );
    });

    it('should send message with attachments', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'File attached',
        type: MessageType.TEXT,
        attachments: [
          {
            fileName: 'document.pdf',
            fileUrl: 'https://example.com/file.pdf',
            fileType: 'application/pdf',
            fileSize: 1024,
            uploadThingKey: 'key-123',
          },
        ],
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage({
        content: 'File attached',
        attachments: [buildAttachment()],
      });

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await service.sendMessage('salon-1', dto);

      expect(result.attachments).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const createCall = prisma.message.create.mock.calls[0]?.[0];
      expect(createCall?.data?.attachments?.create).toHaveLength(1);
    });

    it('should throw NotFoundException if conversation not found', async () => {
      const dto = {
        conversationId: 'nonexistent',
        content: 'Hello',
        type: MessageType.TEXT,
      };

      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(service.sendMessage('sender-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.sendMessage('sender-1', dto)).rejects.toThrow(
        'Conversation non trouvée',
      );
    });

    it('should throw ForbiddenException if user is not participant', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Hello',
        type: MessageType.TEXT,
      };
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);

      await expect(
        service.sendMessage('unauthorized-user', dto),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.sendMessage('unauthorized-user', dto),
      ).rejects.toThrow("Vous n'avez pas accès à cette conversation");
    });

    it('should increment unread count for recipient when sender is salon', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Message from salon',
        type: MessageType.TEXT,
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      await service.sendMessage('salon-1', dto);

      expect(notificationService.incrementUnreadCount).toHaveBeenCalledWith(
        'conv-1',
        'client-1',
      );
    });

    it('should increment unread count for recipient when sender is client', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Message from client',
        type: MessageType.TEXT,
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      await service.sendMessage('client-1', dto);

      expect(notificationService.incrementUnreadCount).toHaveBeenCalledWith(
        'conv-1',
        'salon-1',
      );
    });

    it('should update conversation lastMessageAt', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Hello',
        type: MessageType.TEXT,
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      await service.sendMessage('salon-1', dto);

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { lastMessageAt: expect.any(Date) },
      });
    });
  });

  describe('getMessages', () => {
    it('should return paginated messages in reverse chronological order', async () => {
      const mockMessages = [
        buildMessage({ id: 'msg-3', createdAt: new Date('2026-01-03') }),
        buildMessage({ id: 'msg-2', createdAt: new Date('2026-01-02') }),
        buildMessage({ id: 'msg-1', createdAt: new Date('2026-01-01') }),
      ];
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue(mockMessages);
      prisma.message.count.mockResolvedValue(3);
      prisma.message.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(result.data).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.totalPages).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should throw NotFoundException if conversation not found', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.getMessages('nonexistent', 'user-1', 1, 50),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getMessages('nonexistent', 'user-1', 1, 50),
      ).rejects.toThrow('Conversation non trouvée');
    });

    it('should throw ForbiddenException if user is not participant', async () => {
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);

      await expect(
        service.getMessages('conv-1', 'unauthorized-user', 1, 50),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.getMessages('conv-1', 'unauthorized-user', 1, 50),
      ).rejects.toThrow("Vous n'avez pas accès à cette conversation");
    });

    it('should calculate pagination correctly', async () => {
      const mockMessages = Array.from({ length: 25 }, (_, i) =>
        buildMessage({ id: `msg-${i}` }),
      );
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue(mockMessages);
      prisma.message.count.mockResolvedValue(100);
      prisma.message.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.getMessages('conv-1', 'salon-1', 2, 25);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(25);
      expect(result.totalPages).toBe(4);
      expect(result.hasMore).toBe(true);
    });

    it('should mark unread messages as read', async () => {
      const unreadMessage = buildMessage({
        id: 'msg-unread',
        senderId: 'other-user',
        isRead: false,
      });
      const readMessage = buildMessage({
        id: 'msg-read',
        isRead: true,
      });
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([unreadMessage, readMessage]);
      prisma.message.count.mockResolvedValue(2);
      prisma.message.updateMany.mockResolvedValue({ count: 1 });

      await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['msg-unread'] } },
        data: {
          isRead: true,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          readAt: expect.any(Date),
        },
      });
    });

    it('should reset unread count after marking messages read', async () => {
      const unreadMessage = buildMessage({
        senderId: 'other-user',
        isRead: false,
      });
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([unreadMessage]);
      prisma.message.count.mockResolvedValue(1);
      prisma.message.updateMany.mockResolvedValue({ count: 1 });

      await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(notificationService.resetUnreadCount).toHaveBeenCalledWith(
        'conv-1',
        'salon-1',
      );
    });

    it('should delete pending email notifications when messages are read', async () => {
      const unreadMessage = buildMessage({
        senderId: 'other-user',
        isRead: false,
      });
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([unreadMessage]);
      prisma.message.count.mockResolvedValue(1);
      prisma.message.updateMany.mockResolvedValue({ count: 1 });

      await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(prisma.emailNotificationQueue.deleteMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          recipientUserId: 'salon-1',
          status: 'PENDING',
        },
      });
    });

    it('should not update messages if no unread messages exist', async () => {
      const readMessage = buildMessage({
        id: 'msg-1',
        isRead: true,
      });
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([readMessage]);
      prisma.message.count.mockResolvedValue(1);

      await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });

    it("should not mark sender's own messages as read", async () => {
      const senderMessage = buildMessage({
        id: 'msg-sent',
        senderId: 'salon-1',
        isRead: false,
      });
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([senderMessage]);
      prisma.message.count.mockResolvedValue(1);

      await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('should mark a message as read', async () => {
      const unreadMessage = buildMessage({
        senderId: 'sender-1',
        isRead: false,
        readAt: null,
      });
      const readMessage = buildMessage({
        senderId: 'sender-1',
        isRead: true,
        readAt: new Date('2026-01-01 10:00:00'),
      });

      prisma.message.findUnique.mockResolvedValue({
        ...unreadMessage,
        conversation: buildConversation(),
      });
      prisma.message.update.mockResolvedValue(readMessage);

      const result = await service.markAsRead('msg-1', 'client-1');

      expect(result.isRead).toBe(true);
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: {
          isRead: true,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          readAt: expect.any(Date),
        },
        include: {
          sender: true,
          attachments: true,
        },
      });
    });

    it('should throw NotFoundException if message not found', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.markAsRead('nonexistent', 'user-1')).rejects.toThrow(
        'Message non trouvé',
      );
    });

    it('should throw ForbiddenException if user is not participant', async () => {
      prisma.message.findUnique.mockResolvedValue({
        ...buildMessage(),
        conversation: buildConversation(),
      });

      await expect(
        service.markAsRead('msg-1', 'unauthorized-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.markAsRead('msg-1', 'unauthorized-user'),
      ).rejects.toThrow("Vous n'avez pas accès à ce message");
    });

    it('should not update if user is the sender', async () => {
      const message = buildMessage({
        senderId: 'salon-1',
        isRead: false,
      });

      prisma.message.findUnique.mockResolvedValue({
        ...message,
        conversation: buildConversation(),
      });

      await service.markAsRead('msg-1', 'salon-1');

      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    it('should not update if message already read', async () => {
      const message = buildMessage({
        senderId: 'sender-1',
        isRead: true,
        readAt: new Date('2026-01-01'),
      });

      prisma.message.findUnique.mockResolvedValue({
        ...message,
        conversation: buildConversation(),
      });

      await service.markAsRead('msg-1', 'client-1');

      expect(prisma.message.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteMessage', () => {
    it('should delete a message by author', async () => {
      const message = buildMessage({
        senderId: 'sender-1',
        id: 'msg-1',
      });

      prisma.message.findUnique.mockResolvedValue({
        ...message,
        conversation: buildConversation(),
      });
      prisma.message.delete.mockResolvedValue(message);

      await service.deleteMessage('msg-1', 'sender-1');

      expect(prisma.message.delete).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
      });
    });

    it('should throw NotFoundException if message not found', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessage('nonexistent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteMessage('nonexistent', 'user-1'),
      ).rejects.toThrow('Message non trouvé');
    });

    it('should throw ForbiddenException if user is not the sender', async () => {
      const message = buildMessage({
        senderId: 'sender-1',
      });

      prisma.message.findUnique.mockResolvedValue({
        ...message,
        conversation: buildConversation(),
      });

      await expect(
        service.deleteMessage('msg-1', 'other-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.deleteMessage('msg-1', 'other-user'),
      ).rejects.toThrow('Vous ne pouvez supprimer que vos propres messages');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle message with multiple attachments', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Multiple files',
        type: MessageType.TEXT,
        attachments: [
          {
            fileName: 'file1.pdf',
            fileUrl: 'https://example.com/file1.pdf',
            fileType: 'application/pdf',
            fileSize: 1024,
            uploadThingKey: 'key-1',
          },
          {
            fileName: 'file2.jpg',
            fileUrl: 'https://example.com/file2.jpg',
            fileType: 'image/jpeg',
            fileSize: 2048,
            uploadThingKey: 'key-2',
          },
        ],
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage({
        content: 'Multiple files',
        attachments: [
          buildAttachment({ id: 'att-1' }),
          buildAttachment({ id: 'att-2' }),
        ],
      });

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await service.sendMessage('salon-1', dto);

      expect(result.attachments).toHaveLength(2);
    });

    it('should handle empty messages list', async () => {
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      const result = await service.getMessages('conv-1', 'salon-1', 1, 50);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should map message correctly to response DTO', async () => {
      const message = buildMessage({
        sender: {
          id: 'user-1',
          firstName: 'Jean',
          lastName: 'Dupont',
          salonName: null,
          image: 'https://example.com/image.jpg',
          role: 'CLIENT',
        },
        attachments: [
          buildAttachment({
            id: 'att-1',
            fileName: 'document.pdf',
            fileUrl: 'https://example.com/file.pdf',
          }),
        ],
      });

      prisma.message.findUnique.mockResolvedValue({
        ...message,
        conversation: buildConversation(),
      });
      prisma.message.update.mockResolvedValue(message);

      const result = await service.markAsRead('msg-1', 'client-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'msg-1',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          sender: expect.objectContaining({
            firstName: 'Jean',
            lastName: 'Dupont',
            image: 'https://example.com/image.jpg',
          }),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          attachments: expect.arrayContaining([
            expect.objectContaining({
              fileName: 'document.pdf',
            }),
          ]),
        }),
      );
    });

    it('should handle salon sender and client recipient correctly', async () => {
      const dto = {
        conversationId: 'conv-1',
        content: 'Salon message',
        type: MessageType.TEXT,
      };
      const mockConversation = buildConversation({
        salonId: 'salon-123',
        clientUserId: 'client-456',
      });
      const mockMessage = buildMessage();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      await service.sendMessage('salon-123', dto);

      expect(notificationService.incrementUnreadCount).toHaveBeenCalledWith(
        'conv-1',
        'client-456',
      );
    });

    it('should handle different message types', async () => {
      const dtoImage = {
        conversationId: 'conv-1',
        content: 'Check this image',
        type: MessageType.IMAGE,
      };
      const mockConversation = buildConversation();
      const mockMessage = buildMessage({ type: MessageType.IMAGE });

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await service.sendMessage('salon-1', dtoImage);

      expect(result.type).toBe(MessageType.IMAGE);
    });

    it('should handle page beyond total count', async () => {
      const mockConversation = buildConversation();

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(10);

      const result = await service.getMessages('conv-1', 'salon-1', 5, 10);

      expect(result.page).toBe(5);
      expect(result.data).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });
});
