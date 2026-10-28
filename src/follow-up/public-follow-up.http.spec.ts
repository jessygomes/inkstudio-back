import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FollowupsController } from './follow-up.controller';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

describe('Public follow-up HTTP journey (no user session)', () => {
  let app: INestApplication;
  let saved: boolean;
  const submission = {
    token: 'test-email-token',
    rating: 5,
    photoUrl: 'https://cdn.example.com/test.webp',
    review: 'Merci !',
  };
  beforeAll(async () => {
    const prisma: any = {
      $queryRaw: jest.fn(),
      followUpRequest: {
        findUnique: jest.fn(async ({ where }) =>
          where.token !== 'test-email-token'
            ? null
            : {
                id: 'request',
                status: saved ? 'SUBMITTED' : 'SENT',
                expiresAt: new Date(Date.now() + 86_400_000),
                appointmentId: 'appointment',
                appointment: {
                  userId: 'salon',
                  clientId: 'client',
                  title: 'Projet floral',
                  start: new Date(),
                  user: { salonName: 'Studio' },
                },
              },
        ),
        update: jest.fn(async () => {
          saved = true;
          return {};
        }),
      },
      followUpSubmission: {
        create: jest.fn(async () => ({ id: 'submission' })),
      },
    };
    prisma.$transaction = jest.fn(async (callback) => callback(prisma));
    const module = await Test.createTestingModule({
      controllers: [FollowupsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    saved = false;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('validates a link, saves a response anonymously, then blocks a second response', async () => {
    await request(app.getHttpServer())
      .get('/follow-up/requests/test-email-token')
      .expect(200)
      .expect(({ body }) =>
        expect(body.appointment.title).toBe('Projet floral'),
      );
    await request(app.getHttpServer())
      .post('/follow-up/submissions')
      .send(submission)
      .expect(201)
      .expect({ ok: true });
    await request(app.getHttpServer())
      .post('/follow-up/submissions')
      .send(submission)
      .expect(400);
  });
  it('rejects invalid links and malformed submissions through the real validation pipe', async () => {
    await request(app.getHttpServer())
      .get('/follow-up/requests/not-a-real-token')
      .expect(400);
    await request(app.getHttpServer())
      .post('/follow-up/submissions')
      .send({ ...submission, rating: 0, isPhotoPublic: 'true' })
      .expect(400);
    expect(saved).toBe(false);
  });
});
