/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from 'src/email/mailer.service';
import { SaasService } from 'src/saas/saas.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(() => true),
  hash: jest.fn((value: string) => `hashed-${value}`),
}));

const createPrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  verificationToken: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  passwordResetToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
});

const createMailMock = () => ({
  sendClientEmailVerification: jest.fn(),
  sendEmailVerification: jest.fn(),
  sendAdminNewUserNotification: jest.fn(),
  sendPasswordReset: jest.fn(),
  sendPasswordChangeConfirmation: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let mail: ReturnType<typeof createMailMock>;
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    mail = createMailMock();
    jwt = { sign: jest.fn(() => 'jwt-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: mail },
        { provide: SaasService, useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('returns error when user not found on login', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.login({
      authBody: { email: 'x@y.com', password: 'pwd' },
    });

    expect(result).toEqual({
      error: true,
      message: "L'email ou le mot de passe sont incorrect.",
    });
  });

  it('sends verification email and returns error when email not verified', async () => {
    const user = {
      id: 'u1',
      email: 'x@y.com',
      password: 'hashed',
      role: 'client',
      emailVerified: null,
      firstName: 'A',
      lastName: 'B',
    };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.login({
      authBody: { email: 'x@y.com', password: 'pwd' },
    });

    expect(prisma.verificationToken.deleteMany).toHaveBeenCalled();
    expect(prisma.verificationToken.create).toHaveBeenCalled();
    expect(mail.sendClientEmailVerification).toHaveBeenCalledWith(
      'x@y.com',
      expect.objectContaining({ verificationUrl: expect.any(String) }),
    );
    expect(result).toHaveProperty('error');
  });

  it('returns JWT payload on successful login', async () => {
    const user = {
      id: 'u1',
      email: 'x@y.com',
      password: 'hashed',
      role: 'user',
      emailVerified: new Date(),
    };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.login({
      authBody: { email: 'x@y.com', password: 'pwd' },
    });

    expect(jwt.sign).toHaveBeenCalledWith({ userId: 'u1', role: 'user' });
    expect(result).toEqual({
      access_token: 'jwt-token',
      userId: 'u1',
      role: 'user',
    });
  });

  it('prevents registering an existing user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    const result = await service.register({
      registerBody: {
        email: 'x@y.com',
        salonName: 'S',
        saasPlan: 'FREE',
        password: 'pwd',
        firstName: 'A',
        lastName: 'B',
        phone: '1',
      },
    });

    expect(result).toEqual({
      error: true,
      message: 'Un compte existe déjà avec cet email.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates user, sends mails and verification token on register', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'u1',
      email: 'x@y.com',
      salonName: 'Salon',
      saasPlan: 'FREE',
      firstName: 'A',
      lastName: 'B',
      phone: '1',
    });

    const result = await service.register({
      registerBody: {
        email: 'x@y.com',
        salonName: 'Salon',
        saasPlan: 'FREE',
        password: 'pwd',
        firstName: 'A',
        lastName: 'B',
        phone: '1',
      },
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'x@y.com',
          password: 'hashed-pwd',
        }),
      }),
    );
    expect(mail.sendAdminNewUserNotification).toHaveBeenCalled();
    expect(prisma.verificationToken.create).toHaveBeenCalled();
    expect(mail.sendEmailVerification).toHaveBeenCalled();
    expect(result).toHaveProperty('message');
  });
});
