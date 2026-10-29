/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import {
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { Server } from 'http';
import {
  SecurityRateLimiter,
  SecurityThrottleGuard,
  COUNTER_SCRIPT,
} from './security-throttle';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../database/prisma.service';
import { RegistrationThrottleGuard } from './registration-throttle.guard';
import { RegistrationRateLimiterService } from './registration-rate-limiter.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentsService } from '../appointments/appointments.service';
import { SaasLimitGuard } from '../saas/saas-limit.guard';
import { JwtStrategy } from './jwt.strategy';

function redisDouble() {
  const counters = new Map<string, number>();
  const client = {
    isReady: true,
    eval: jest.fn(
      async (
        _script: string,
        input: { keys: string[]; arguments: string[] },
      ) => {
        const key = input.keys[0];
        const count = (counters.get(key) || 0) + 1;
        counters.set(key, count);
        return [count, Number(input.arguments[0])];
      },
    ),
  };
  return { client, counters, redis: { getClient: () => client } };
}

describe('Shared security counters', () => {
  it('uses atomic Redis INCR + TTL repair and hashed identity keys', async () => {
    const { client, redis } = redisDouble();
    const limiter = new SecurityRateLimiter(redis as any);
    const axes = [
      { kind: 'email', value: 'private@example.test', max: 1, seconds: 900 },
    ];
    expect((await limiter.consume('login', axes)).allowed).toBe(true);
    expect(await limiter.consume('login', axes)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 900,
    });
    const [script, input] = client.eval.mock.calls[0];
    expect(script).toBe(COUNTER_SCRIPT);
    expect(script).toContain("redis.call('EXPIRE'");
    expect(input.keys[0]).not.toContain('private@example.test');
    expect(input.keys[0]).toMatch(
      /^security:attempts:v1:login:email:[a-f0-9]{64}$/,
    );
  });
  it('shares counters between service instances and concurrent attempts', async () => {
    const { redis } = redisDouble();
    const a = new SecurityRateLimiter(redis as any),
      b = new SecurityRateLimiter(redis as any);
    const axes = [{ kind: 'ip', value: '127.0.0.1', max: 3, seconds: 60 }];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? a : b).consume('login', axes),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect((await a.consume('reset', axes)).allowed).toBe(true);
  });
  it.each(['offline', 'exception', 'invalid'])(
    'fails closed when Redis is %s',
    async (failure) => {
      const { client, redis } = redisDouble();
      if (failure === 'offline') client.isReady = false;
      if (failure === 'exception')
        client.eval.mockRejectedValue(new Error('unavailable'));
      if (failure === 'invalid') client.eval.mockResolvedValue([-1, -1]);
      await expect(
        new SecurityRateLimiter(redis as any).consume('login', [
          { kind: 'ip', value: 'ip', max: 10, seconds: 60 },
        ]),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );
  it('fails closed on timeout instead of waiting indefinitely', async () => {
    jest.useFakeTimers();
    try {
      const { client, redis } = redisDouble();
      client.eval.mockImplementation(() => new Promise(() => {}));
      const result = expect(
        new SecurityRateLimiter(redis as any).consume('login', [
          { kind: 'ip', value: 'ip', max: 10, seconds: 60 },
        ]),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await jest.advanceTimersByTimeAsync(1501);
      await result;
    } finally {
      jest.useRealTimers();
    }
  });
  it('keeps registration protected and normalizes email identity', async () => {
    const { redis } = redisDouble();
    const limiter = new SecurityRateLimiter(redis as any);
    const registration = new RegistrationRateLimiterService(limiter);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await registration.consume({
            ip: `ip-${i}`,
            email: ' Test@Example.test ',
          })
        ).allowed,
      ).toBe(true);
    expect(
      await registration.consume({
        ip: 'different',
        email: 'test@example.test',
      }),
    ).toMatchObject({ allowed: false, blockedBy: 'email' });
  });
});

describe('Security throttle at HTTP boundaries', () => {
  let app: INestApplication<Server>;
  let state: ReturnType<typeof redisDouble>;
  let jwt: JwtService;
  const previous = process.env.JWT_SECRET;
  const auth = {
    login: jest.fn(),
    loginWithGoogle: jest.fn(),
    sendResetPasswordEmail: jest.fn(),
    resetPassword: jest.fn(),
    verifyEmail: jest.fn(),
    changePassword: jest.fn(),
  };
  const appointments = { createByClient: jest.fn() };
  beforeEach(async () => {
    process.env.JWT_SECRET = 'security-throttle-test-only-secret';
    state = redisDouble();
    jest.clearAllMocks();
    for (const mock of Object.values(auth))
      mock.mockResolvedValue({ message: 'ok' });
    appointments.createByClient.mockResolvedValue({ error: false });
    const module = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({ secret: process.env.JWT_SECRET }),
      ],
      controllers: [AuthController, AppointmentsController],
      providers: [
        JwtStrategy,
        SecurityThrottleGuard,
        {
          provide: SecurityRateLimiter,
          useValue: new SecurityRateLimiter(state.redis as any),
        },
        { provide: AuthService, useValue: auth },
        { provide: UserService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: AppointmentsService, useValue: appointments },
      ],
    })
      .overrideGuard(RegistrationThrottleGuard)
      .useValue({ canActivate: () => true })
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
  afterEach(async () => {
    await app.close();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  it.each([
    ['login', 10],
    ['forgot-password', 3],
    ['reset-password', 5],
  ])(
    '%s rejects excess email attempts and includes Retry-After',
    async (route, limit) => {
      const body = {
        email: 'client@example.test',
        password: 'valid-password',
        token: 'a'.repeat(64),
      };
      for (let i = 0; i < limit; i++)
        await request(app.getHttpServer())
          .post(`/auth/${route}`)
          .send({ ...body, email: i % 2 ? 'CLIENT@example.test' : body.email })
          .expect(201);
      const result = await request(app.getHttpServer())
        .post(`/auth/${route}`)
        .send(body)
        .expect(429);
      expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
      expect(result.headers['cache-control']).toContain('no-store');
      expect(
        auth[
          route === 'login'
            ? 'login'
            : route === 'forgot-password'
              ? 'sendResetPasswordEmail'
              : 'resetPassword'
        ],
      ).toHaveBeenCalledTimes(limit);
    },
  );
  it('limits verification attempts before any token lookup', async () => {
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer())
        .get('/auth/verify-email')
        .query({ email: 'client@example.test', token: 'a'.repeat(64) })
        .expect(200);
    await request(app.getHttpServer())
      .get('/auth/verify-email')
      .query({ email: 'CLIENT@example.test', token: 'b'.repeat(64) })
      .expect(429);
    expect(auth.verifyEmail).toHaveBeenCalledTimes(10);
  });
  it.each([
    '/auth/login',
    '/auth/google',
    '/auth/forgot-password',
    '/auth/reset-password',
  ])('refuses %s when Redis is unavailable', async (route) => {
    state.client.isReady = false;
    await request(app.getHttpServer())
      .post(route)
      .send({
        email: 'client@example.test',
        password: 'password123',
        idToken: 'token',
        token: 'a'.repeat(64),
      })
      .expect(503);
    for (const mock of Object.values(auth)) expect(mock).not.toHaveBeenCalled();
  });
  it('does not trust forged forwarding headers to reset the IP budget', async () => {
    for (let i = 0; i < 120; i++)
      await request(app.getHttpServer())
        .post('/auth/google')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({ idToken: 'token' })
        .expect(201);
    await request(app.getHttpServer())
      .post('/auth/google')
      .set('X-Forwarded-For', '198.51.100.5')
      .send({ idToken: 'token' })
      .expect(429);
    expect(auth.loginWithGoogle).toHaveBeenCalledTimes(120);
  });
  const booking = (email = 'guest@example.test') => ({
    userId: 'salon',
    rdvBody: {
      prestation: 'PROJET',
      start: '2030-01-02T09:00:00Z',
      end: '2030-01-02T10:00:00Z',
      clientFirstname: 'Guest',
      clientLastname: 'Test',
      clientEmail: email,
      clientPhone: '0100000000',
      skin: 'mate',
      tatoueurId: 'internal',
    },
  });
  it('limits guest booking email attempts before creation', async () => {
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/appointments/by-client')
        .send(booking())
        .expect(201);
    await request(app.getHttpServer())
      .post('/appointments/by-client')
      .send(booking())
      .expect(429);
    expect(appointments.createByClient).toHaveBeenCalledTimes(5);
  });
  it('applies a connected client budget even when the claimed email changes', async () => {
    const token = jwt.sign({ userId: 'client', role: 'client' });
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer())
        .post('/appointments/by-client')
        .set('Authorization', `Bearer ${token}`)
        .send(booking(`guest${i}@example.test`))
        .expect(201);
    await request(app.getHttpServer())
      .post('/appointments/by-client')
      .set('Authorization', `Bearer ${token}`)
      .send(booking('other@example.test'))
      .expect(429);
    expect(appointments.createByClient).toHaveBeenCalledTimes(10);
    expect(
      [...state.counters.keys()].some((key) => key.includes(':booking:user:')),
    ).toBe(true);
  });
  it('applies the password-change account budget after JWT authentication', async () => {
    const token = jwt.sign({ userId: 'client', role: 'client' });
    const body = {
      currentPassword: 'old-password',
      newPassword: 'new-password',
      confirmPassword: 'new-password',
    };
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(429);
    expect(auth.changePassword).toHaveBeenCalledTimes(5);
  });
  it.each([
    { password: 'short', token: 'a'.repeat(64) },
    { password: 'password123', token: '123456' },
    { password: {}, token: 'a'.repeat(64) },
  ])(
    'validates reset input before hashing or changing the password: %p',
    async (body) => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ email: 'client@example.test', ...body })
        .expect(400);
      expect(auth.resetPassword).not.toHaveBeenCalled();
    },
  );
});
