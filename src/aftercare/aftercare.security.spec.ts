import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../database/prisma.service';
import { AftercareController } from './aftercare.controller';
import { AftercareService } from './aftercare.service';
import { TattooHistoryController } from '../tattoo-history/tattoo-history.controller';
import { TattooHistoryService } from '../tattoo-history/tattoo-history.service';
import { FollowupsController } from '../follow-up/follow-up.controller';
import { MailService } from '../email/mailer.service';

describe('SEC-04 clinical records HTTP access', () => {
  const secret = 'clinical-records-tests-only-signing-secret';
  const previousSecret = process.env.JWT_SECRET;
  const prisma = {
    client: { findUnique: jest.fn() },
    aftercare: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    tattooHistory: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    followUpSubmission: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    followUpRequest: {
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const mail = { sendFollowUpResponse: jest.fn() };
  let app: INestApplication<Server>;
  let jwt: JwtService;
  const operations = [
    {
      method: 'post',
      path: '/aftercare',
      body: { clientId: 'client', comment: 'healing' },
    },
    {
      method: 'patch',
      path: '/aftercare/record',
      body: { comment: 'updated' },
    },
    { method: 'delete', path: '/aftercare/record', body: {} },
    {
      method: 'post',
      path: '/tattoo-history',
      body: { clientId: 'client', date: '2026-10-29', description: 'tattoo' },
    },
  ] as const;
  const bearer = () =>
    `Bearer ${jwt.sign({ userId: 'owner', role: 'user_salon' })}`;
  const send = (op: (typeof operations)[number]) =>
    request(app.getHttpServer())[op.method](op.path).send(op.body);
  const expectNoWrites = () => {
    for (const write of [
      prisma.aftercare.create,
      prisma.aftercare.update,
      prisma.aftercare.delete,
      prisma.tattooHistory.create,
      prisma.tattooHistory.update,
      prisma.tattooHistory.delete,
      prisma.followUpSubmission.update,
      prisma.followUpSubmission.delete,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(mail.sendFollowUpResponse).not.toHaveBeenCalled();
  };
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [
        AftercareController,
        TattooHistoryController,
        FollowupsController,
      ],
      providers: [
        JwtStrategy,
        AftercareService,
        TattooHistoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    jwt = module.get(JwtService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.client.findUnique.mockResolvedValue({
      id: 'client',
      userId: 'owner',
    });
    prisma.aftercare.findUnique.mockResolvedValue({
      id: 'record',
      client: { userId: 'owner' },
    });
    prisma.aftercare.create.mockResolvedValue({ id: 'record' });
    prisma.aftercare.update.mockResolvedValue({ id: 'record' });
    prisma.aftercare.delete.mockResolvedValue({ id: 'record' });
    prisma.tattooHistory.create.mockResolvedValue({ id: 'history' });
  });
  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  describe.each(operations)('$method $path', (operation) => {
    it.each(['missing', 'expired', 'forged'])(
      'rejects %s authentication before database access',
      async (kind) => {
        const req = send(operation);
        if (kind !== 'missing')
          req.set(
            'Authorization',
            `Bearer ${kind === 'expired' ? jwt.sign({ userId: 'owner' }, { expiresIn: -1 }) : new JwtService({ secret: 'different-secret' }).sign({ userId: 'owner' })}`,
          );
        await req.expect(401);
        expect(prisma.client.findUnique).not.toHaveBeenCalled();
        expect(prisma.aftercare.findUnique).not.toHaveBeenCalled();
        expectNoWrites();
      },
    );
    it('rejects access to another account records without any write', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'client',
        userId: 'victim',
      });
      prisma.aftercare.findUnique.mockResolvedValue({
        id: 'record',
        client: { userId: 'victim' },
      });
      await send(operation).set('Authorization', bearer()).expect(403);
      expectNoWrites();
    });
    it('preserves successful writes for the actual owner', async () => {
      const response = await send(operation)
        .set('Authorization', bearer())
        .expect(operation.method === 'post' ? 201 : 200);
      expect((response.body as { error: boolean }).error).toBe(false);
    });
  });

  it('atomically connects a new aftercare to the JWT-owned client', async () => {
    await send(operations[0]).set('Authorization', bearer()).expect(201);
    expect(
      (prisma.aftercare.create.mock.calls as unknown[][])[0][0],
    ).toMatchObject({
      data: { client: { connect: { id: 'client', userId: 'owner' } } },
    });
  });
  it('atomically connects a new tattoo history to the JWT-owned client', async () => {
    await send(operations[3]).set('Authorization', bearer()).expect(201);
    expect(
      (prisma.tattooHistory.create.mock.calls as unknown[][])[0][0],
    ).toMatchObject({
      data: { client: { connect: { id: 'client', userId: 'owner' } } },
    });
  });
  it('ignores attempts to transfer an aftercare to another client or owner', async () => {
    await request(app.getHttpServer())
      .patch('/aftercare/record')
      .set('Authorization', bearer())
      .send({
        comment: 'updated',
        clientId: 'victim-client',
        userId: 'victim',
        client: { connect: { id: 'victim-client' } },
      })
      .expect(200);
    expect(prisma.aftercare.update).toHaveBeenCalledWith({
      where: { id: 'record', client: { userId: 'owner' } },
      data: {
        photoUrl: undefined,
        comment: 'updated',
        approved: undefined,
        visibleInPortfolio: undefined,
      },
    });
  });
  it('scopes deletion to the owner at mutation time', async () => {
    await send(operations[2]).set('Authorization', bearer()).expect(200);
    expect(prisma.aftercare.delete).toHaveBeenCalledWith({
      where: { id: 'record', client: { userId: 'owner' } },
    });
  });
  it.each(['patch', 'delete'] as const)(
    'returns 404 for a missing aftercare on %s',
    async (method) => {
      prisma.aftercare.findUnique.mockResolvedValue(null);
      const http = request(app.getHttpServer());
      await http[method]('/aftercare/missing')
        .set('Authorization', bearer())
        .send({})
        .expect(404);
      expectNoWrites();
    },
  );
  it('rejects malformed tattoo dates before writing', async () => {
    await request(app.getHttpServer())
      .post('/tattoo-history')
      .set('Authorization', bearer())
      .send({ clientId: 'client', date: 'invalid-date' })
      .expect(400);
    expectNoWrites();
  });
  it.each(['reply', 'delete'])(
    'keeps professional follow-up %s protected from anonymous and other accounts',
    async (operation) => {
      await request(app.getHttpServer())
        .post(`/follow-up/${operation}/submission`)
        .send({ reply: 'hello' })
        .expect(401);
      prisma.followUpSubmission.findUnique.mockResolvedValue({
        id: 'submission',
        userId: 'victim',
        isAnswered: false,
        appointment: { client: { email: 'synthetic@example.test' }, user: {} },
      });
      await request(app.getHttpServer())
        .post(`/follow-up/${operation}/submission`)
        .set('Authorization', bearer())
        .send({ reply: 'hello' })
        .expect(403);
      expectNoWrites();
      expect(prisma.followUpRequest.update).not.toHaveBeenCalled();
      expect(prisma.followUpRequest.delete).not.toHaveBeenCalled();
    },
  );
});
