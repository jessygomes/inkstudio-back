import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../redis/cache.service';
import { MailService } from '../email/mailer.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PublicContactRateLimiterService } from './public-contact-rate-limiter.service';
import { PublicProfileAccessModule } from './public-profile-access';
import {
  publicUserProfile,
  publicUserProfileSelect,
} from './public-user-profile';

describe('SEC-05 public/private profile boundary', () => {
  const secret = 'profile-data-boundary-test-only-secret';
  const previous = process.env.JWT_SECRET;
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    salonTatoueurTeamRequest: { findMany: jest.fn() },
  };
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let app: INestApplication<Server>;
  let jwt: JwtService;
  let service: UserService;
  const client = {
    id: 'client',
    role: 'client',
    publicVisibility: 'VISIBLE',
    email: 'private@example.test',
    phone: 'private-phone',
    firstName: 'Private',
    lastName: 'Person',
    clientProfile: {
      birthDate: '1990-01-01',
      pseudo: 'client-pseudo',
      city: 'private-city',
    },
  };
  const professional = {
    id: 'salon',
    role: 'user_salon',
    publicVisibility: 'VISIBLE',
    salonName: 'Test Studio',
    city: 'Paris',
    postalCode: '75001',
    email: 'contact@example.test',
    phone: 'business-phone',
    address: 'business-address',
    prestations: ['TATTOO'],
    style: [],
    salonHours: '{}',
    Tatoueur: [{ id: 'internal', name: 'Artist', rdvBookingEnabled: true }],
    appointmentBookingEnabled: true,
    saasPlanDetails: {
      currentPlan: 'BUSINESS',
      agendaMode: 'GLOBAL',
      stripeSubscriptionId: 'private-stripe',
    },
    password: 'private-hash',
    googleSubject: 'private-subject',
    clientProfile: client.clientProfile,
    stripeCustomerId: 'private-billing',
    followUpEmailDelayDays: 7,
  };
  let current: Record<string, unknown>;
  const bearer = (userId: string, role = 'client') =>
    `Bearer ${jwt.sign({ userId, role })}`;

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [
        PublicProfileAccessModule,
        PassportModule,
        JwtModule.register({ secret }),
      ],
      controllers: [UserController],
      providers: [
        JwtStrategy,
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: MailService, useValue: {} },
        {
          provide: PublicContactRateLimiterService,
          useValue: { consume: jest.fn() },
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    jwt = module.get(JwtService);
    service = module.get(UserService);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    current = { ...professional };
    prisma.user.findUnique.mockImplementation(
      ({
        where,
        select,
      }: {
        where: { id: string };
        select: Record<string, unknown>;
      }) =>
        Promise.resolve(
          where.id === current.id
            ? Object.fromEntries(
                Object.keys(select)
                  .filter((key) => key in current)
                  .map((key) => [key, current[key]]),
              )
            : null,
        ),
    );
    prisma.user.findMany.mockResolvedValue([]);
    prisma.salonTatoueurTeamRequest.findMany.mockResolvedValue([]);
    cache.get.mockResolvedValue({ ...client, password: 'old-cache-secret' });
  });
  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });

  it.each(['client', 'admin', 'formateur'])(
    'does not publish a %s account even when its visibility is VISIBLE',
    async (role) => {
      current = { ...client, role };
      await request(app.getHttpServer()).get('/users/client').expect(404);
      expect(cache.get).not.toHaveBeenCalled();
    },
  );
  it('does not expose private client data through the service without the global guard', async () => {
    current = client;
    expect(await service.getPublicUserById({ userId: 'client' })).toBeNull();
  });
  it.each(['VISIBLE', 'SEARCH_HIDDEN'])(
    'keeps the %s professional profile and booking fields public',
    async (publicVisibility) => {
      current = { ...professional, publicVisibility };
      const response = await request(app.getHttpServer())
        .get('/users/salon')
        .expect(200);
      expect(response.body as unknown).toMatchObject({
        id: 'salon',
        salonName: 'Test Studio',
        email: 'contact@example.test',
        phone: 'business-phone',
        appointmentBookingEnabled: true,
        Tatoueur: [{ id: 'internal', name: 'Artist', rdvBookingEnabled: true }],
        saasPlanDetails: { currentPlan: 'BUSINESS', agendaMode: 'GLOBAL' },
      });
      const text = response.text;
      for (const field of [
        'password',
        'googleSubject',
        'clientProfile',
        'birthDate',
        'stripeCustomerId',
        'stripeSubscriptionId',
        'followUpEmailDelayDays',
      ])
        expect(text).not.toContain(field);
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    },
  );
  it('returns 404 for a missing public account', async () => {
    await request(app.getHttpServer()).get('/users/missing').expect(404);
  });
  it('does not reuse a stale private cache to expose a hidden profile', async () => {
    current = { ...professional, publicVisibility: 'HIDDEN' };
    await request(app.getHttpServer()).get('/users/salon').expect(404);
    expect(cache.get).not.toHaveBeenCalled();
  });
  it('filters role and visibility again when loading a profile selected by slug', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'salon',
        salonName: 'Test Studio',
        city: 'Paris',
        postalCode: '75001',
      },
    ]);
    const response = await request(app.getHttpServer())
      .get('/users/test-studio/paris-75001')
      .expect(200);
    expect(response.text).not.toContain('private-stripe');
    const calls = prisma.user.findUnique.mock.calls as unknown as [
      { where: Record<string, unknown> },
    ][];
    expect(calls[0][0].where).toEqual({
      id: 'salon',
      role: { in: ['user', 'user_salon', 'user_tatoueur'] },
      publicVisibility: { not: 'HIDDEN' },
    });
  });
  it('uses an explicit field boundary even if an upstream record includes extra private columns', () => {
    const result = publicUserProfile(professional);
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('clientProfile');
    expect(result).not.toHaveProperty('googleSubject');
    expect(result).not.toHaveProperty('stripeCustomerId');
    expect(result?.saasPlanDetails).toEqual({
      currentPlan: 'BUSINESS',
      agendaMode: 'GLOBAL',
    });
    expect(publicUserProfileSelect).not.toHaveProperty('clientProfile');
  });

  describe.each(['param', 'private'])('private %s route', (suffix) => {
    it.each(['missing', 'expired', 'forged'])(
      'rejects %s authentication',
      async (kind) => {
        current = client;
        const req = request(app.getHttpServer()).get(`/users/client/${suffix}`);
        if (kind !== 'missing')
          req.set(
            'Authorization',
            `Bearer ${kind === 'expired' ? jwt.sign({ userId: 'client' }, { expiresIn: -1 }) : new JwtService({ secret: 'other-secret' }).sign({ userId: 'client' })}`,
          );
        await req.expect(401);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      },
    );
    it.each(['client', 'admin'])(
      'rejects another account even with the %s role',
      async (role) => {
        current = client;
        await request(app.getHttpServer())
          .get(`/users/client/${suffix}`)
          .set('Authorization', bearer('other', role))
          .expect(403);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      },
    );
    it('allows the client to read their own private fields without public caching', async () => {
      current = client;
      const response = await request(app.getHttpServer())
        .get(`/users/client/${suffix}`)
        .set('Authorization', bearer('client'))
        .expect(200)
        .expect('Cache-Control', 'private, no-store');
      expect(response.body as unknown).toMatchObject({
        email: 'private@example.test',
        phone: 'private-phone',
        clientProfile: { birthDate: '1990-01-01' },
      });
      expect(cache.get).not.toHaveBeenCalled();
    });
    it('keeps the hidden professional own settings accessible', async () => {
      current = { ...professional, publicVisibility: 'HIDDEN' };
      await request(app.getHttpServer())
        .get(`/users/salon/${suffix}`)
        .set('Authorization', bearer('salon', 'user_salon'))
        .expect(200);
    });
  });
});
