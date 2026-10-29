import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Server } from 'node:http';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../database/prisma.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

describe('Upload ownership HTTP security', () => {
  const secret = 'upload-tests-only-secret-at-least-32-bytes';
  const original = {
    jwt: process.env.JWT_SECRET,
    pro: process.env.UPLOAD_OWNERSHIP_PRO_SECRET,
    public: process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET,
  };
  const prisma = { uploadedFile: { upsert: jest.fn(), findMany: jest.fn() } };
  let app: INestApplication<Server>;
  let jwt: JwtService;
  const registration = () => ({
    application: 'pro',
    ownerUserId: 'owner',
    key: 'owned.png',
    timestamp: Date.now(),
  });
  const signature = (
    body: ReturnType<typeof registration>,
    signingSecret = secret,
  ) =>
    createHmac('sha256', signingSecret)
      .update(
        JSON.stringify([
          body.application,
          body.ownerUserId,
          body.key,
          body.timestamp,
        ]),
      )
      .digest('hex');
  const bearer = (userId = 'owner', role = 'user_salon') =>
    `Bearer ${jwt.sign({ userId, role })}`;
  const payload = () => ({ application: 'pro', fileKeys: ['owned.png'] });

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    process.env.UPLOAD_OWNERSHIP_PRO_SECRET = secret;
    process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET = secret + '-public';
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [UploadsController],
      providers: [
        JwtStrategy,
        UploadsService,
        { provide: PrismaService, useValue: prisma },
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
    prisma.uploadedFile.findMany.mockResolvedValue([
      { key: 'owned.png', ownerUserId: 'owner' },
    ]);
    prisma.uploadedFile.upsert.mockResolvedValue({ ownerUserId: 'owner' });
  });
  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries({
      JWT_SECRET: original.jwt,
      UPLOAD_OWNERSHIP_PRO_SECRET: original.pro,
      UPLOAD_OWNERSHIP_PUBLIC_SECRET: original.public,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects unsigned registration even with a valid user JWT', async () => {
    await request(app.getHttpServer())
      .post('/uploads/register')
      .set('Authorization', bearer())
      .send(registration())
      .expect(403);
    expect(prisma.uploadedFile.upsert).not.toHaveBeenCalled();
  });
  it('accepts a signed callback and preserves immutable ownership on retries', async () => {
    const body = registration();
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .post('/uploads/register')
        .set('x-upload-signature', signature(body))
        .send(body)
        .expect(201);
    expect(prisma.uploadedFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
        create: { application: 'pro', key: 'owned.png', ownerUserId: 'owner' },
      }),
    );
  });
  it.each([
    'owner',
    'key',
    'application',
    'expired',
    'future',
    'wrong-secret',
    'malformed',
  ])('rejects %s registration forgery', async (kind) => {
    const body = registration();
    let signed = signature(body);
    if (kind === 'owner') body.ownerUserId = 'victim';
    if (kind === 'key') body.key = 'victim.png';
    if (kind === 'application') body.application = 'public';
    if (kind === 'expired' || kind === 'future') {
      body.timestamp += (kind === 'expired' ? -1 : 1) * 600_000;
      signed = signature(body);
    }
    if (kind === 'wrong-secret') signed = signature(body, secret + '-other');
    if (kind === 'malformed') signed = 'invalid';
    await request(app.getHttpServer())
      .post('/uploads/register')
      .set('x-upload-signature', signed)
      .send(body)
      .expect(403);
    expect(prisma.uploadedFile.upsert).not.toHaveBeenCalled();
  });
  it('refuses reassignment of an existing file even for a signed callback', async () => {
    prisma.uploadedFile.upsert.mockResolvedValue({ ownerUserId: 'another' });
    const body = registration();
    await request(app.getHttpServer())
      .post('/uploads/register')
      .set('x-upload-signature', signature(body))
      .send(body)
      .expect(403);
  });
  it('fails closed when registration secret is missing', async () => {
    const body = registration();
    delete process.env.UPLOAD_OWNERSHIP_PRO_SECRET;
    try {
      await request(app.getHttpServer())
        .post('/uploads/register')
        .set('x-upload-signature', signature(body))
        .send(body)
        .expect(503);
    } finally {
      process.env.UPLOAD_OWNERSHIP_PRO_SECRET = secret;
    }
  });
  it.each(['missing', 'forged', 'expired'])(
    'rejects %s deletion JWT',
    async (kind) => {
      const token =
        kind === 'forged'
          ? new JwtService({ secret: 'wrong' }).sign({ userId: 'owner' })
          : jwt.sign({ userId: 'owner' }, { expiresIn: -1 });
      const req = request(app.getHttpServer())
        .post('/uploads/authorize-deletion')
        .send(payload());
      if (kind !== 'missing') req.set('Authorization', `Bearer ${token}`);
      await req.expect(401);
      expect(prisma.uploadedFile.findMany).not.toHaveBeenCalled();
    },
  );
  it('authorizes only the JWT owner and isolates applications', async () => {
    await request(app.getHttpServer())
      .post('/uploads/authorize-deletion')
      .set('Authorization', bearer())
      .send(payload())
      .expect(201)
      .expect('Cache-Control', 'private, no-store')
      .expect({ authorized: true });
    expect(prisma.uploadedFile.findMany).toHaveBeenCalledWith({
      where: { application: 'pro', key: { in: ['owned.png'] } },
      select: { key: true, ownerUserId: true },
    });
  });
  it.each(['other-owner', 'unknown', 'mixed'])(
    'rejects the entire %s batch',
    async (kind) => {
      const body = payload();
      if (kind === 'other-owner')
        prisma.uploadedFile.findMany.mockResolvedValue([
          { key: 'owned.png', ownerUserId: 'victim' },
        ]);
      if (kind === 'unknown')
        prisma.uploadedFile.findMany.mockResolvedValue([]);
      if (kind === 'mixed') body.fileKeys.push('unknown.png');
      await request(app.getHttpServer())
        .post('/uploads/authorize-deletion')
        .set('Authorization', bearer())
        .send(body)
        .expect(403);
    },
  );
  it('does not allow a normal account to select a different owner', async () => {
    await request(app.getHttpServer())
      .post('/uploads/authorize-deletion')
      .set('Authorization', bearer('attacker'))
      .send({ ...payload(), ownerUserId: 'owner' })
      .expect(403);
    expect(prisma.uploadedFile.findMany).not.toHaveBeenCalled();
  });
  it('allows admin cleanup only for files owned by the explicitly targeted account', async () => {
    await request(app.getHttpServer())
      .post('/uploads/authorize-deletion')
      .set('Authorization', bearer('administrator', 'admin'))
      .send({ ...payload(), ownerUserId: 'owner' })
      .expect(201);
    prisma.uploadedFile.findMany.mockResolvedValue([
      { key: 'owned.png', ownerUserId: 'victim' },
    ]);
    await request(app.getHttpServer())
      .post('/uploads/authorize-deletion')
      .set('Authorization', bearer('administrator', 'admin'))
      .send({ ...payload(), ownerUserId: 'owner' })
      .expect(403);
  });
  it.each(
    [
      [],
      ['owned.png', 'owned.png'],
      ['https://example.test/f/key'],
      [5],
      Array(21).fill('key'),
      ['x'.repeat(513)],
    ].map((fileKeys) => ({ fileKeys })),
  )('rejects malformed deletion keys %j', async ({ fileKeys }) => {
    await request(app.getHttpServer())
      .post('/uploads/authorize-deletion')
      .set('Authorization', bearer())
      .send({ ...payload(), fileKeys })
      .expect(400);
    expect(prisma.uploadedFile.findMany).not.toHaveBeenCalled();
  });
});
