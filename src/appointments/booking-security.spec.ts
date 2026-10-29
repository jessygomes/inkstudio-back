import { SecurityThrottleGuard } from '../auth/security-throttle';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- Isolated Prisma transaction doubles. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { SaasLimitGuard } from '../saas/saas-limit.guard';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { PrestationType } from './dto/create-appointment.dto';
import { SkinTone } from './constants/skin-tone.constants';

const body = {
  prestation: PrestationType.PROJET,
  start: '2026-11-02T09:00:00Z',
  end: '2026-11-02T10:00:00Z',
  clientFirstname: 'Guest',
  clientLastname: 'Test',
  clientEmail: 'guest@example.test',
  clientPhone: '0100000000',
  skin: SkinTone.MATE,
  tatoueurId: 'internal',
};

describe('SEC-06 booking HTTP identity', () => {
  const secret = 'booking-identity-tests-only-signing-secret';
  const previous = process.env.JWT_SECRET;
  const service = { createByClient: jest.fn() };
  let app: INestApplication<Server>;
  let jwt: JwtService;
  const payload = () => ({ userId: 'salon', rdvBody: { ...body } });
  const post = (value: object = payload()) =>
    request(app.getHttpServer()).post('/appointments/by-client').send(value);
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [AppointmentsController],
      providers: [
        JwtStrategy,
        { provide: AppointmentsService, useValue: service },
      ],
    })
      .overrideGuard(SecurityThrottleGuard)
      .useValue({canActivate: () => true})
      .overrideGuard(SaasLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    jwt = module.get(JwtService);
    await app.init();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    service.createByClient.mockResolvedValue({ error: false });
  });
  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  it('preserves guest booking without claiming an account', async () => {
    await post().expect(201);
    expect(
      (service.createByClient.mock.calls as unknown[][])[0][0],
    ).toMatchObject({
      userId: 'salon',
      rdvBody: body,
      authenticatedClientUserId: undefined,
    });
  });
  it('rejects a guest claiming a client ID', async () => {
    await post({ ...payload(), clientUserId: 'victim' }).expect(403);
    expect(service.createByClient).not.toHaveBeenCalled();
  });
  it.each(['forged', 'expired', 'malformed'])(
    'rejects %s credentials instead of falling back to a guest',
    async (kind) => {
      const token =
        kind === 'malformed'
          ? 'invalid'
          : kind === 'expired'
            ? jwt.sign({ userId: 'owner', role: 'client' }, { expiresIn: -1 })
            : new JwtService({ secret: 'different-secret' }).sign({
                userId: 'owner',
                role: 'client',
              });
      await post().set('Authorization', `Bearer ${token}`).expect(401);
      expect(service.createByClient).not.toHaveBeenCalled();
    },
  );
  it.each(['user_salon', 'user_tatoueur', 'admin'])(
    'rejects a %s token claiming to be a client',
    async (role) => {
      await post()
        .set('Authorization', `Bearer ${jwt.sign({ userId: 'owner', role })}`)
        .expect(403);
      expect(service.createByClient).not.toHaveBeenCalled();
    },
  );
  it('gets the connected client from the signed principal', async () => {
    await post()
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ userId: 'owner', role: 'client' })}`,
      )
      .expect(201);
    expect(
      (service.createByClient.mock.calls as unknown[][])[0][0],
    ).toMatchObject({
      userId: 'salon',
      rdvBody: body,
      authenticatedClientUserId: 'owner',
    });
  });
  it('rejects a conflicting legacy top-level identity', async () => {
    await post({ ...payload(), clientUserId: 'victim' })
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ userId: 'owner', role: 'client' })}`,
      )
      .expect(403);
    expect(service.createByClient).not.toHaveBeenCalled();
  });
  it('strips a nested identity supplied by the caller', async () => {
    await post({ ...payload(), rdvBody: { ...body, clientUserId: 'victim' } })
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ userId: 'owner', role: 'client' })}`,
      )
      .expect(201);
    const input = (
      service.createByClient.mock.calls as unknown as [
        { authenticatedClientUserId: string; rdvBody: object },
      ][]
    )[0][0];
    expect(input.authenticatedClientUserId).toBe('owner');
    expect(input.rdvBody).not.toHaveProperty('clientUserId');
  });
});

describe('SEC-06 identity and transaction persistence', () => {
  let service: AppointmentsService;
  let db: any;
  let tx: any;
  let mail: any;
  let conversations: any;
  let state: { clients: any[]; appointments: any[]; details: any[] };
  let failDetails: boolean;
  let accountAvailable: boolean;
  let professionalBoardShared: boolean;
  let boardPublished: boolean;
  let proposalAccepted: boolean;
  let proposalStillValid: boolean;
  const account = {
    id: 'owner',
    role: 'client',
    email: 'owner@example.test',
    firstName: 'Owner',
    lastName: 'Client',
    phone: '0200000000',
    clientProfile: { birthDate: new Date('1990-01-01') },
  };
  beforeEach(() => {
    state = { clients: [], appointments: [], details: [] };
    failDetails = false;
    accountAvailable = true;
    professionalBoardShared = false;
    boardPublished = false;
    proposalAccepted = false;
    proposalStillValid = true;
    const rootWrite = jest.fn(() => {
      throw new Error('Write escaped transaction');
    });
    db = {
      user: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === 'salon'
              ? {
                  id: 'salon',
                  role: 'user_salon',
                  saasPlan: 'PRO',
                  email: 'salon@example.test',
                  salonName: 'Studio',
                  linkedTatoueurs: [],
                  projectAppointmentDurationMinutes: 60,
                  projectAppointmentIsFree: true,
                publicVisibility: 'VISIBLE', salonHours: "{\"monday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"tuesday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"wednesday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"thursday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"friday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"saturday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"sunday\":{\"start\":\"00:00\",\"end\":\"24:00\"}}", prestations: ['PROJET', 'TATTOO', 'PIERCING', 'RETOUCHE'],
                }
              : where.id === 'owner' && accountAvailable
                ? account
                : null,
          ),
        ),
      },
      tatoueur: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'internal',
          userId: 'salon',
          name: 'Artist',
        }),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: rootWrite,
        update: rootWrite,
      },
      client: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            state.clients.find(
              (c) => c.userId === where.userId && c.email === where.email,
            ) ?? null,
          ),
        ),
        create: rootWrite,
        update: rootWrite,
      },
      projectProposal: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            proposalAccepted &&
              where.professionalId === 'salon' &&
              where.moodboardId === 'owned-board' &&
              where.client.email === account.email
              ? { id: 'accepted', client: { id: 'owner', role: 'client' } }
              : null,
          ),
        ),
      },
      tattooDetail: { create: rootWrite },
      conversation: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback) => {
        const draft = structuredClone(state);
        tx = {
          $queryRaw: jest.fn((parts) =>
            Promise.resolve(
              parts.join('').includes('ProjectProposal') && proposalStillValid
                ? [{ id: 'accepted' }]
                : [],
            ),
          ),
          user: db.user,
          tatoueur: { findFirst: jest.fn().mockResolvedValue({"id":"internal","hours":"{\"monday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"tuesday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"wednesday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"thursday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"friday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"saturday\":{\"start\":\"00:00\",\"end\":\"24:00\"},\"sunday\":{\"start\":\"00:00\",\"end\":\"24:00\"}}","rdvBookingEnabled":true}) },
          blockedTimeSlot: { findFirst: jest.fn().mockResolvedValue(null) },
          client: {
            findFirst: jest.fn(({ where }) =>
              Promise.resolve(
                draft.clients.find(
                  (c) =>
                    c.userId === where.userId &&
                    (where.linkedUserId
                      ? c.linkedUserId === where.linkedUserId
                      : c.id === where.id),
                ) ?? null,
              ),
            ),
            create: jest.fn(({ data }) => {
              const record = { id: `client-${draft.clients.length}`, ...data };
              draft.clients.push(record);
              return Promise.resolve(record);
            }),
            update: jest.fn(({ where, data }) => {
              const record = draft.clients.find((c) => c.id === where.id);
              Object.assign(record, data);
              return Promise.resolve(record);
            }),
          },
          moodboard: {
            findFirst: jest.fn(({ where }) =>
              Promise.resolve(
                where.id === 'owned-board' &&
                  where.clientProfile.userId === 'owner' &&
                  (!where.OR || professionalBoardShared || boardPublished)
                  ? {
                      id: 'owned-board',
                      projectStatus: boardPublished ? 'OPEN' : 'PRIVATE',
                    }
                  : null,
              ),
            ),
          },
          appointment: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(({ data }) => {
              const record = {
                id: `appointment-${draft.appointments.length}`,
                ...data,
              };
              draft.appointments.push(record);
              return Promise.resolve(record);
            }),
            update: jest.fn(({ where, data }) => {
              const record = draft.appointments.find((c) => c.id === where.id);
              Object.assign(record, data);
              return Promise.resolve(record);
            }),
          },
          tattooDetail: {
            create: jest.fn(({ data }) => {
              if (failDetails) throw new Error('private database failure');
              const record = { id: 'detail', ...data };
              draft.details.push(record);
              return Promise.resolve(record);
            }),
          },
        };
        const result = await callback(tx);
        state = draft;
        return result;
      }),
    };
    const afterCommit = jest.fn(() => {
      expect(state.appointments).toHaveLength(1);
      return Promise.resolve();
    });
    mail = {
      sendPendingAppointmentNotification: afterCommit,
      sendAutoConfirmedAppointment: afterCommit,
      sendNewAppointmentNotification: afterCommit,
      sendAppointmentConfirmation: afterCommit,
    };
    conversations = { createConversation: jest.fn().mockResolvedValue({}) };
    service = new AppointmentsService(
      db,
      mail,
      {} as any,
      {} as any,
      {} as any,
      { delPattern: jest.fn() } as any,
      conversations,
    );
  });
  const book = (authenticatedClientUserId?: string, overrides: object = {}) =>
    service.createByClient({
      userId: 'salon',
      rdvBody: { ...body, ...overrides },
      authenticatedClientUserId,
    });

  it('does not link or reuse a victim CRM record when a guest supplies its email', async () => {
    state.clients.push({
      id: 'victim-crm',
      userId: 'salon',
      linkedUserId: 'victim',
      email: body.clientEmail,
      firstName: 'Private name',
    });
    expect((await book()).error).toBe(false);
    expect(state.clients).toHaveLength(2);
    expect(state.appointments[0]).toMatchObject({ clientId: 'client-1' });
    expect(state.appointments[0].clientUserId).toBeUndefined();
    expect(
      db.user.findUnique.mock.calls.some(([args]) => args.where.email),
    ).toBe(false);
    expect(conversations.createConversation).not.toHaveBeenCalled();
  });
  it('uses the authenticated account for CRM linkage, contact email and conversation', async () => {
    expect(
      (await book('owner', { clientEmail: 'victim@example.test' })).error,
    ).toBe(false);
    expect(state.clients[0]).toMatchObject({
      linkedUserId: 'owner',
      email: 'owner@example.test',
      firstName: 'Owner',
    });
    expect(state.appointments[0].clientUserId).toBe('owner');
    expect(mail.sendAutoConfirmedAppointment.mock.calls[0][0]).toBe(
      'owner@example.test',
    );
    expect(conversations.createConversation).toHaveBeenCalledWith(
      'salon',
      expect.objectContaining({ clientUserId: 'owner' }),
    );
  });
  it('reuses a previously linked CRM record only within the selected salon', async () => {
    state.clients.push(
      {
        id: 'other-salon',
        userId: 'other',
        linkedUserId: 'owner',
        email: 'owner@example.test',
      },
      {
        id: 'same-salon',
        userId: 'salon',
        linkedUserId: 'owner',
        email: 'old@example.test',
      },
    );
    expect((await book('owner')).error).toBe(false);
    expect(state.clients).toHaveLength(2);
    expect(state.appointments[0].clientId).toBe('same-salon');
    expect(mail.sendAutoConfirmedAppointment.mock.calls[0][0]).toBe(
      'owner@example.test',
    );
  });
  it('does not take over an unlinked legacy CRM record by matching its email', async () => {
    state.clients.push({
      id: 'legacy',
      userId: 'salon',
      linkedUserId: null,
      email: account.email,
    });
    expect((await book('owner')).error).toBe(false);
    expect(state.clients[0].linkedUserId).toBeNull();
    expect(state.clients[1].linkedUserId).toBe('owner');
  });
  it('does not claim a deleted or no-longer-client account from a stale principal', async () => {
    accountAvailable = false;
    expect((await book('owner')).error).toBe(true);
    expect(state.clients).toHaveLength(0);
    expect(state.appointments).toHaveLength(0);
  });
  it.each([undefined, 'owner'])(
    'refuses a foreign moodboard before persisting a CRM record (principal %s)',
    async (principal) => {
      expect(
        (await book(principal, { moodboardId: 'victim-board' })).error,
      ).toBe(true);
      expect(state.clients).toHaveLength(0);
      expect(state.appointments).toHaveLength(0);
      expect(tx.client.create).not.toHaveBeenCalled();
      expect(mail.sendAutoConfirmedAppointment).not.toHaveBeenCalled();
    },
  );
  it('allows the authenticated client to attach their own moodboard', async () => {
    expect((await book('owner', { moodboardId: 'owned-board' })).error).toBe(
      false,
    );
    expect(state.appointments[0].moodboardId).toBe('owned-board');
  });
  it.each(['guest', 'client', 'professional'])(
    'rolls back CRM and appointment when details fail for %s booking',
    async (kind) => {
      failDetails = true;
      const result =
        kind === 'professional'
          ? await service.create({ userId: 'salon', rdvBody: body })
          : await book(kind === 'client' ? 'owner' : undefined);
      expect(result.error).toBe(true);
      expect(state).toEqual({ clients: [], appointments: [], details: [] });
      expect(mail.sendAutoConfirmedAppointment).not.toHaveBeenCalled();
      expect(mail.sendAppointmentConfirmation).not.toHaveBeenCalled();
      expect(db.client.create).not.toHaveBeenCalled();
      expect(db.appointment.create).not.toHaveBeenCalled();
    },
  );
  it('does not report an already committed booking as failed when email delivery fails', async () => {
    mail.sendAutoConfirmedAppointment.mockRejectedValue(
      new Error('mail unavailable'),
    );
    expect((await book()).error).toBe(false);
    expect(state.appointments).toHaveLength(1);
    expect(state.details).toHaveLength(1);
  });
  it('does not discover or bind an unrelated account in professional creation by email', async () => {
    expect(
      (
        await service.create({
          userId: 'salon',
          rdvBody: { ...body, clientEmail: account.email },
        })
      ).error,
    ).toBe(false);
    expect(state.clients[0].linkedUserId).toBeUndefined();
    expect(state.appointments[0].clientUserId).toBeUndefined();
    expect(
      db.user.findUnique.mock.calls.some(([args]) => args.where.email),
    ).toBe(false);
    expect(conversations.createConversation).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'professional creation requires a private board to have been shared (shared %s)',
    async (shared) => {
      professionalBoardShared = shared;
      state.clients.push({
        id: 'linked',
        userId: 'salon',
        linkedUserId: 'owner',
        email: account.email,
        firstName: 'Owner',
        lastName: 'Client',
      });
      const result = await service.create({
        userId: 'salon',
        rdvBody: {
          ...body,
          clientEmail: account.email,
          moodboardId: 'owned-board',
        },
      });
      expect(result.error).toBe(!shared);
      expect(state.appointments).toHaveLength(shared ? 1 : 0);
      expect(tx.moodboard.findFirst.mock.calls[0][0].where).toMatchObject({
        clientProfile: { userId: 'owner' },
        OR: expect.any(Array),
      });
    },
  );
  it('keeps a published client project usable for a professional who already has the client link', async () => {
    boardPublished = true;
    state.clients.push({
      id: 'linked',
      userId: 'salon',
      linkedUserId: 'owner',
      email: account.email,
      firstName: 'Owner',
      lastName: 'Client',
    });
    const result = await service.create({
      userId: 'salon',
      rdvBody: {
        ...body,
        clientEmail: account.email,
        moodboardId: 'owned-board',
      },
    });
    expect(result.error).toBe(false);
    expect(state.appointments[0].moodboardId).toBe('owned-board');
  });
  it('allows a first account link through an accepted proposal without copying private profile fields', async () => {
    proposalAccepted = true;
    professionalBoardShared = true;
    const result = await service.create({
      userId: 'salon',
      rdvBody: {
        ...body,
        clientEmail: account.email,
        moodboardId: 'owned-board',
      },
    });
    expect(result.error).toBe(false);
    expect(state.clients[0]).toMatchObject({
      linkedUserId: 'owner',
      firstName: 'Guest',
      phone: body.clientPhone,
    });
    expect(state.appointments[0].clientUserId).toBe('owner');
    expect(
      db.user.findUnique.mock.calls.some(([args]) => args.where.id === 'owner'),
    ).toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
  it('does not attach a legacy medical dossier when a proposal proves a new account link', async () => {
    proposalAccepted = true;
    professionalBoardShared = true;
    state.clients.push({
      id: 'legacy',
      userId: 'salon',
      linkedUserId: null,
      email: account.email,
    });
    const result = await service.create({
      userId: 'salon',
      rdvBody: {
        ...body,
        clientEmail: account.email,
        moodboardId: 'owned-board',
      },
    });
    expect(result.error).toBe(false);
    expect(state.clients[0].linkedUserId).toBeNull();
    expect(state.appointments[0].clientId).toBe('client-1');
    expect(state.clients[1].linkedUserId).toBe('owner');
  });
  it('rolls back when an accepted proposal was withdrawn before the transaction could lock it', async () => {
    proposalAccepted = true;
    proposalStillValid = false;
    professionalBoardShared = true;
    const result = await service.create({
      userId: 'salon',
      rdvBody: {
        ...body,
        clientEmail: account.email,
        moodboardId: 'owned-board',
      },
    });
    expect(result.error).toBe(true);
    expect(state).toEqual({ clients: [], appointments: [], details: [] });
    expect(mail.sendAppointmentConfirmation).not.toHaveBeenCalled();
  });
});
