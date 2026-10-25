import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { assertContactCanMessage } from '../messaging/contact-access';

describe('Shared moodboard projects', () => {
  let prisma: any;
  let service: ProjectsService;
  let notifications: any;
  let proposalEmails: any;
  const professional = {
    role: 'user_tatoueur',
    salonId: null,
    saasPlan: 'PRO',
    saasPlanUntil: null,
    saasPlanDetails: {
      currentPlan: 'PRO',
      planStatus: 'ACTIVE',
      endDate: null,
    },
  };
  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(professional),
        findMany: jest.fn().mockResolvedValue([]),
      },
      moodboard: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'board',
          name: 'Fleurs',
          projectStatus: 'OPEN',
          clientProfile: { userId: 'client' },
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      professionalBlock: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      projectProposal: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'proposal', ...data }),
          ),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn(),
      },
      message: { create: jest.fn() },
      projectProposalEmail: { upsert: jest.fn() },
      inboxThread: { upsert: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    notifications = {
      incrementUnreadCount: jest.fn().mockResolvedValue(undefined),
    };
    proposalEmails = {
      requestDelivery: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProjectsService(prisma, notifications, proposalEmails);
  });

  it('limits proposals to the requested moodboard and authenticated client', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    await service.list('client', undefined, 'board');
    expect(prisma.projectProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientUserId: 'client', moodboardId: 'board' },
      }),
    );
  });

  it('lists all client proposals when no moodboard filter is supplied', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    await service.list('client');
    expect(prisma.projectProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientUserId: 'client' },
      }),
    );
  });

  it('includes previously contacted projects without restricting them to OPEN', async () => {
    await service.explore('pro', { page: 1, scope: 'proposals' });
    const query = prisma.moodboard.findMany.mock.calls[0][0];
    expect(query.where.proposals).toEqual({ some: { professionalId: 'pro' } });
    expect(query.where.projectStatus).toBeUndefined();
    expect(prisma.moodboard.count).toHaveBeenCalledWith({ where: query.where });
  });

  it('filters sent proposals by their response status and professional', async () => {
    await service.explore('pro', {
      page: 2,
      scope: 'proposals',
      proposalStatus: 'REFUSED',
    });
    expect(prisma.moodboard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          proposals: { some: { professionalId: 'pro', status: 'REFUSED' } },
        }),
        skip: 12,
        take: 12,
      }),
    );
  });

  it.each([
    { role: 'client' },
    { saasPlan: 'FREE' },
    { saasPlanUntil: new Date(0) },
    {
      saasPlanDetails: {
        ...professional.saasPlanDetails,
        planStatus: 'PAST_DUE',
      },
    },
    { salonId: 'salon' },
  ])('denies Explorer for ineligible professionals: %j', async (override) => {
    prisma.user.findUnique.mockResolvedValue({ ...professional, ...override });
    await expect(service.explore('pro', { page: 1 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.moodboard.findMany).not.toHaveBeenCalled();
  });

  it('combines filters, excludes blocked clients, and returns only open projects without client contact details', async () => {
    prisma.professionalBlock.findMany.mockResolvedValue([
      { clientUserId: 'blocked' },
    ]);
    await service.explore('pro', {
      page: 2,
      city: 'Paris',
      size: 'LARGE',
      category: 'Nature',
      style: 'Réalisme',
      hashtag: '#Fleurs',
    });
    const query = prisma.moodboard.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      skip: 12,
      take: 12,
      where: {
        projectStatus: 'OPEN',
        projectSize: 'LARGE',
        projectStyles: { has: 'réalisme' },
        projectHashtags: { has: 'fleurs' },
        clientProfile: { userId: { notIn: ['blocked'] } },
      },
    });
    expect(query.select.clientProfile).toBeUndefined();
    expect(query.select.appointments).toBeUndefined();
  });

  it.each([null, { id: 'existing' }])(
    'stores a proposal without touching messaging even with an existing conversation: %j',
    async (existing) => {
      prisma.conversation.findFirst.mockResolvedValue(existing);
      prisma.projectProposal.create.mockResolvedValue({
        id: 'proposal',
        status: 'PENDING',
        createdAt: new Date(),
      });
      const result = await service.propose('board', 'pro', ' Bonjour ');
      expect(prisma.projectProposal.create).toHaveBeenCalledWith({
        data: {
          moodboardId: 'board',
          professionalId: 'pro',
          clientUserId: 'client',
          message: 'Bonjour',
        },
        select: { id: true, status: true, createdAt: true },
      });
      expect(result).not.toHaveProperty('clientUserId');
      expect(result).not.toHaveProperty('conversationId');
      expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.inboxThread.upsert).not.toHaveBeenCalled();
      expect(notifications.incrementUnreadCount).not.toHaveBeenCalled();
    },
  );

  it('does not allow a second proposal after refusal', async () => {
    prisma.projectProposal.findUnique.mockResolvedValue({ status: 'REFUSED' });
    await expect(
      service.propose('board', 'pro', 'Relance'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it.each([1, 2, 4, 5, 6, 10, 11, 12, 20])(
    'queues an email only at the three per-project milestones: %i',
    async (count) => {
      prisma.projectProposal.count.mockResolvedValue(count);
      await service.propose('board', 'pro', 'Bonjour');
      const expected = [1, 5, 11].includes(count);
      expect(prisma.projectProposalEmail.upsert).toHaveBeenCalledTimes(
        expected ? 1 : 0,
      );
      expect(proposalEmails.requestDelivery).toHaveBeenCalledTimes(
        expected ? 1 : 0,
      );
      expect(prisma.projectProposal.count).toHaveBeenCalledWith({
        where: { moodboardId: 'board' },
      });
      if (expected)
        expect(prisma.projectProposalEmail.upsert).toHaveBeenCalledWith({
          where: {
            moodboardId_threshold: { moodboardId: 'board', threshold: count },
          },
          create: { moodboardId: 'board', threshold: count },
          update: {},
        });
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    },
  );

  it('does not contact a blocked client or a closed project', async () => {
    prisma.professionalBlock.findUnique.mockResolvedValue({ id: 'block' });
    await expect(
      service.propose('board', 'pro', 'Bonjour'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    prisma.moodboard.findUnique.mockResolvedValue({ projectStatus: 'CLOSED' });
    await expect(
      service.propose('board', 'pro', 'Bonjour'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.projectProposal.create).not.toHaveBeenCalled();
  });

  it('only the owning client can publish a moodboard', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    prisma.moodboard.findFirst.mockResolvedValue(null);
    await expect(
      service.publish('board', 'stranger', { status: 'OPEN' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.moodboard.update).not.toHaveBeenCalled();
  });

  it('normalizes project metadata and leaves unrelated moodboard data intact', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    prisma.moodboard.findFirst.mockResolvedValue({
      id: 'board',
      publishedAt: null,
    });
    await service.publish('board', 'client', {
      status: 'OPEN',
      styles: [' Floral ', 'floral'],
      hashtags: ['#Fleurs', 'fleurs'],
      city: ' Paris ',
      size: 'SMALL',
      mobility: 'RADIUS',
      radiusKm: 50,
    });
    expect(prisma.moodboard.update).toHaveBeenCalledWith({
      where: { id: 'board' },
      data: expect.objectContaining({
        projectCity: 'Paris',
        projectStyles: ['floral'],
        projectHashtags: ['fleurs'],
        projectSize: 'SMALL',
        projectRadiusKm: 50,
      }),
    });
    expect(
      prisma.moodboard.update.mock.calls[0][0].data.images,
    ).toBeUndefined();
  });

  it.each([null, { id: 'existing' }])(
    'creates or reuses the conversation only on acceptance: %j',
    async (existing) => {
      prisma.user.findUnique.mockResolvedValue({ role: 'client' });
      prisma.conversation.findFirst.mockResolvedValue(existing);
      prisma.projectProposal.findFirst.mockResolvedValue({
        id: 'proposal',
        professionalId: 'pro',
        status: 'PENDING',
        conversationId: null,
        message: 'Original proposal',
      });
      const conversationId = existing?.id || 'new';
      prisma.projectProposal.findUniqueOrThrow.mockResolvedValue({
        id: 'proposal',
        conversationId,
        status: 'ACCEPTED',
      });
      await service.respond('proposal', 'client', 'ACCEPTED');
      expect(prisma.conversation.create).toHaveBeenCalledTimes(
        existing ? 0 : 1,
      );
      expect(prisma.projectProposal.update).toHaveBeenCalledWith({
        where: { id: 'proposal' },
        data: { conversationId },
      });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId,
          senderId: 'pro',
          type: 'TEXT',
          content: 'Original proposal',
        },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: conversationId },
        data: expect.objectContaining({ projectContactPending: false }),
      });
    },
  );

  it('refuses a request without changing an existing conversation or sending its message', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    prisma.projectProposal.findFirst.mockResolvedValue({
      id: 'proposal',
      professionalId: 'pro',
      status: 'PENDING',
      message: 'Original proposal',
    });
    prisma.projectProposal.findUniqueOrThrow.mockResolvedValue({
      id: 'proposal',
      status: 'REFUSED',
      conversationId: null,
    });
    await service.respond('proposal', 'client', 'REFUSED');
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.inboxThread.upsert).not.toHaveBeenCalled();
    expect(notifications.incrementUnreadCount).not.toHaveBeenCalled();
  });

  it('does not insert the first message twice when concurrent decisions race', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    prisma.projectProposal.findFirst.mockResolvedValue({
      id: 'proposal',
      professionalId: 'pro',
      status: 'PENDING',
    });
    prisma.projectProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.respond('proposal', 'client', 'ACCEPTED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('rejects replayed decisions and requests belonging to another client', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    prisma.projectProposal.findFirst.mockResolvedValue(null);
    await expect(
      service.respond('proposal', 'stranger', 'ACCEPTED'),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.projectProposal.findFirst.mockResolvedValue({ status: 'REFUSED' });
    await expect(
      service.respond('proposal', 'client', 'ACCEPTED'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks message sending in both directions until consent or while blocked', async () => {
    const conversation = {
      salonId: 'pro',
      clientUserId: 'client',
      projectContactPending: true,
    };
    await expect(
      assertContactCanMessage(prisma, conversation),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertContactCanMessage(prisma, {
        ...conversation,
        projectContactPending: false,
      }),
    ).resolves.toBeUndefined();
    prisma.professionalBlock.findUnique.mockResolvedValue({ id: 'block' });
    await expect(
      assertContactCanMessage(prisma, {
        ...conversation,
        projectContactPending: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
