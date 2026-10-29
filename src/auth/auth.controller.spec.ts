import { SecurityThrottleGuard } from './security-throttle';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../database/prisma.service';
import { RegistrationThrottleGuard } from './registration-throttle.guard';

describe('AuthController', () => {
  let app: INestApplication;
  const authService = { loginWithGoogle: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UserService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(SecurityThrottleGuard)
      .useValue({canActivate: () => true})
      .overrideGuard(RegistrationThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();
    jest.resetAllMocks();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    { email: 'admin@example.test' },
    { accessToken: 'google-access-token', email: 'admin@example.test' },
    { idToken: '' },
    { idToken: 123 },
    { idToken: 'x'.repeat(16385) },
  ])('rejects a Google login without a valid token input: %p', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/google')
      .send(body)
      .expect(400);
    expect(authService.loginWithGoogle).not.toHaveBeenCalled();
  });

  it('forwards only the ID token and discards client-supplied identity fields', async () => {
    authService.loginWithGoogle.mockResolvedValue({
      access_token: 'verified-jwt',
    });
    await request(app.getHttpServer())
      .post('/auth/google')
      .send({
        idToken: 'google-id-token',
        email: 'admin@example.test',
        role: 'admin',
        googleId: 'forged-subject',
        firstName: 'Forged',
        avatar: 'https://attacker.test/image',
      })
      .expect(201)
      .expect({ access_token: 'verified-jwt' });
    expect(authService.loginWithGoogle).toHaveBeenCalledWith({
      idToken: 'google-id-token',
    });
  });

  it('returns 401 when the ID token is rejected', async () => {
    authService.loginWithGoogle.mockRejectedValue(
      new UnauthorizedException('Jeton Google invalide ou expiré.'),
    );
    const response = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'forged-jwt' })
      .expect(401);
    expect(response.body.message).toBe('Jeton Google invalide ou expiré.');
  });
});
