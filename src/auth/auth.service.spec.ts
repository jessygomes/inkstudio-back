/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from 'src/email/mailer.service';
import { SaasService } from 'src/saas/saas.service';
import { StripeService } from 'src/stripe/stripe.service';
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleIdentityService } from './google-identity.service';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(() => true),
  hash: jest.fn((value: string) => `hashed-${value}`),
}));

const createPrismaMock = () => ({
  subscriptionInvitationRedemption: { create: jest.fn() },
  subscriptionInvitation: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  verificationToken: {
    findUnique: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn(),
  },
  passwordResetToken: {
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
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

const createStripeMock = () => ({
  createCheckoutSession: jest.fn(),
});

describe('AuthService', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  beforeAll(() => { process.env.FRONTEND_URL = 'https://app.example.com'; });
  afterAll(() => { if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = originalFrontendUrl; });
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let mail: ReturnType<typeof createMailMock>;
  let stripe: ReturnType<typeof createStripeMock>;
  let jwt: { sign: jest.Mock };
  let googleIdentity: { verify: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(async fn => fn(prisma));
    mail = createMailMock();
    stripe = createStripeMock();
    jwt = { sign: jest.fn(() => 'jwt-token') };
    googleIdentity = { verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: mail },
        { provide: SaasService, useValue: { getPlanConfiguration: jest.fn().mockReturnValue({}) } },
        { provide: StripeService, useValue: stripe },
        { provide: GoogleIdentityService, useValue: googleIdentity },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ============================================================================
  // TESTS POUR LA FONCTION LOGIN
  // ============================================================================

  describe('login()', () => {
    it('returns error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.login({
        authBody: { email: 'notfound@y.com', password: 'pwd' },
      });

      expect(result).toEqual({
        error: true,
        message: "L'email ou le mot de passe sont incorrect.",
      });
    });

    it('returns error when password is invalid', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-correct',
        role: 'user',
        emailVerified: new Date(),
        clientProfile: null,
      });
      // Mock bcrypt compare to return false
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const result = await service.login({
        authBody: { email: 'user@example.com', password: 'wrongpwd' },
      });

      expect(result).toEqual({
        error: true,
        message: "L'email ou le mot de passe sont incorrect.",
      });
    });

    it('sends verification email when client email is not verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'client@example.com',
        password: 'hashed-pwd',
        role: 'client',
        emailVerified: null,
        firstName: 'Jean',
        lastName: 'Dupont',
        clientProfile: null,
      });

      const result = await service.login({
        authBody: { email: 'client@example.com', password: 'pwd' },
      });

      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { email: 'client@example.com' },
      });
      expect(prisma.verificationToken.create).toHaveBeenCalled();
      expect(mail.sendClientEmailVerification).toHaveBeenCalledWith(
        'client@example.com',
        expect.objectContaining({ verificationUrl: expect.any(String) }),
      );
      expect(result).toHaveProperty('error');
    });

    it('sends verification email when salon email is not verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'salon@example.com',
        password: 'hashed-pwd',
        role: 'salon',
        emailVerified: null,
        salonName: 'Tattoo Studio',
        clientProfile: null,
      });

      const result = await service.login({
        authBody: { email: 'salon@example.com', password: 'pwd' },
      });

      expect(mail.sendEmailVerification).toHaveBeenCalledWith(
        'salon@example.com',
        expect.objectContaining({ verificationUrl: expect.any(String) }),
        'Tattoo Studio',
      );
      expect(result).toHaveProperty('error');
    });

    it('returns JWT and client data on successful client login', async () => {
      const clientProfile = {
        id: 'cp1',
        userId: 'u1',
        pseudo: 'john_doe',
        birthDate: new Date('1990-01-01'),
        city: 'Paris',
        postalCode: '75001',
      };
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'client@example.com',
        password: 'hashed-pwd',
        role: 'client',
        emailVerified: new Date(),
        firstName: 'Jean',
        lastName: 'Dupont',
        image: 'profile.jpg',
        clientProfile,
      });

      const result = await service.login({
        authBody: { email: 'client@example.com', password: 'pwd' },
      });

      expect(jwt.sign).toHaveBeenCalledWith({ userId: 'u1', role: 'client' });
      expect(result).toMatchObject({
        access_token: 'jwt-token',
        id: 'u1',
        role: 'client',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'client@example.com',
        clientProfile,
        image: 'profile.jpg',
      });
    });

    it('returns JWT and salon data on successful salon login', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'salon1',
        email: 'salon@example.com',
        password: 'hashed-pwd',
        role: 'salon',
        emailVerified: new Date(),
        salonName: 'Tattoo Studio Pro',
        image: 'salon.jpg',
        saasPlan: 'PRO',
        phone: '0123456789',
        address: '123 Rue de la Paix',
        verifiedSalon: true,
        salonHours: 'Mon-Fri 10-18',
        clientProfile: null,
      });

      const result = await service.login({
        authBody: { email: 'salon@example.com', password: 'pwd' },
      });

      expect(jwt.sign).toHaveBeenCalledWith({
        userId: 'salon1',
        role: 'salon',
      });
      expect(result).toMatchObject({
        access_token: 'jwt-token',
        id: 'salon1',
        salonName: 'Tattoo Studio Pro',
        role: 'salon',
        email: 'salon@example.com',
        image: 'salon.jpg',
        saasPlan: 'PRO',
        phone: '0123456789',
        address: '123 Rue de la Paix',
        verifiedSalon: true,
        salonHours: 'Mon-Fri 10-18',
      });
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION REGISTER
  // ============================================================================

  describe('register()', () => {
    const invitedBody = {
      email: 'invited@example.com', role: 'user_salon' as const, salonName: 'Invited Studio',
      saasPlan: 'BUSINESS' as const, checkoutPlan: 'BUSINESS' as const,
      firstName: 'Alex', lastName: 'Test', phone: '', password: 'Password1!', invitationToken: 'a'.repeat(64),
    };
    const invitation = {
      id: 'invite-1', email: invitedBody.email, role: invitedBody.role, plan: 'BUSINESS',
      durationMonths: 12, maxUses: 1, useCount: 0, revokedAt: null, expiresAt: new Date('2099-01-01'),
    };

    it.each(['user_salon', 'user_tatoueur'] as const)('grants a 12 month invitation to %s without Stripe or a native trial', async role => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-26T12:00:00Z'));
      try {
        const plan = role === 'user_salon' ? 'BUSINESS' : 'PRO';
        prisma.subscriptionInvitation.findUnique.mockResolvedValue({ ...invitation, role, plan });
        prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.create.mockResolvedValue({ id: 'invited-user', email: invitedBody.email, saasPlan: plan });
        prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
        const result = await service.register({ registerBody: { ...invitedBody, role, saasPlan: plan, checkoutPlan: plan } });
        expect(result).toMatchObject({ offeredEndDate: '2027-10-26T12:00:00.000Z', trialEndDate: null, checkoutUrl: null });
        expect(prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({
          saasPlan: plan, saasPlanUntil: new Date('2027-10-26T12:00:00Z'),
          saasPlanDetails: { create: expect.objectContaining({ currentPlan: plan, paymentMethod: 'INVITATION', planStatus: 'ACTIVE', monthlyPrice: 0, trialEndDate: null, nextPaymentDate: null }) },
        }) });
        expect(prisma.subscriptionInvitationRedemption.create).toHaveBeenCalledWith({ data: { invitationId: 'invite-1', userId: 'invited-user', redeemedAt: expect.any(Date), durationMonths: 12, plan } });
        expect(prisma.subscriptionInvitation.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ useCount: { lt: 1 }, maxUses: 1, revokedAt: null }), data: { useCount: { increment: 1 } } });
        expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
      } finally { jest.useRealTimers(); }
    });

    it.each([
      null, { ...invitation, useCount: 1 }, { ...invitation, revokedAt: new Date() },
      { ...invitation, expiresAt: new Date('2020-01-01') }, { ...invitation, email: 'another@example.com' },
      { ...invitation, role: 'user_tatoueur' },
    ])('rejects an unavailable or mismatched invitation', async record => {
      prisma.subscriptionInvitation.findUnique.mockResolvedValue(record);
      const result = await service.register({ registerBody: invitedBody });
      expect(result).toMatchObject({ error: true });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('does not create a second account when another request has already claimed the invitation', async () => {
      prisma.subscriptionInvitation.findUnique.mockResolvedValue(invitation);
      prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
      const result = await service.register({ registerBody: invitedBody });
      expect(result).toMatchObject({ error: true });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('accepts different emails on a shared link and refuses the sixth signup with a quota of five', async () => {
      const shared = { ...invitation, email: null, maxUses: 5, useCount: 0 };
      prisma.subscriptionInvitation.findUnique.mockImplementation(async () => ({ ...shared }));
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
      prisma.subscriptionInvitation.updateMany.mockImplementation(async (query: { where: { useCount: { lt: number } } }) => {
        if (shared.useCount >= query.where.useCount.lt) return { count: 0 };
        shared.useCount++;
        return { count: 1 };
      });
      prisma.user.create.mockImplementation(async ({ data }: { data: { email: string } }) => ({ id: data.email, email: data.email }));
      for (let index = 0; index < 5; index++) {
        const result = await service.register({ registerBody: { ...invitedBody, email: `person${index}@example.com` } });
        expect(result).toMatchObject({ checkoutUrl: null });
        expect(result).not.toHaveProperty('error');
      }
      const rejected = await service.register({ registerBody: { ...invitedBody, email: 'sixth@example.com' } });
      expect(rejected).toMatchObject({ error: true });
      expect(prisma.user.create).toHaveBeenCalledTimes(5);
      expect(prisma.subscriptionInvitationRedemption.create).toHaveBeenCalledTimes(5);
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it.each(['user_salon', 'user_tatoueur'] as const)('allows a flexible invitation to create a %s with its corresponding offered plan', async role => {
      const plan = role === 'user_salon' ? 'BUSINESS' : 'PRO';
      prisma.subscriptionInvitation.findUnique.mockResolvedValue({ ...invitation, role: null, plan: null, email: null, maxUses: 5 });
      prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'flexible-user', email: invitedBody.email });
      prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
      const result = await service.register({ registerBody: { ...invitedBody, role, saasPlan: plan, checkoutPlan: plan } });
      expect(result).not.toHaveProperty('error');
      expect(prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role, saasPlan: plan }) });
      expect(prisma.subscriptionInvitationRedemption.create).toHaveBeenCalledWith({ data: expect.objectContaining({ plan }) });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('enforces the last available place even when simultaneous requests read the same counter', async () => {
      const shared = { ...invitation, email: null, maxUses: 5, useCount: 4 };
      prisma.subscriptionInvitation.findUnique.mockResolvedValue({ ...shared });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
      prisma.subscriptionInvitation.updateMany.mockImplementation(async () => shared.useCount++ === 4 ? { count: 1 } : { count: 0 });
      prisma.user.create.mockResolvedValue({ id: 'last-user', email: 'last@example.com' });
      const results = await Promise.all(['first@example.com', 'second@example.com'].map(email => service.register({ registerBody: { ...invitedBody, email } })));
      expect(results.filter(result => 'error' in result && result.error)).toHaveLength(1);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.subscriptionInvitationRedemption.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['user_salon', 'BUSINESS', '2026-04-01T10:00:00.000Z'],
      ['user_tatoueur', 'PRO', '2026-04-30T10:00:00.000Z'],
    ] as const)('creates a native %s %s trial without Stripe', async (role, plan, expiry) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-31T10:00:00Z'));
      try {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.create.mockResolvedValue({ id: 'native-1', email: 'native@example.com', firstName: 'Alex', lastName: 'Test', salonName: 'Native', saasPlan: plan });
        const result = await service.register({ registerBody: {
          email: 'native@example.com', role, saasPlan: plan, checkoutPlan: plan, salonName: 'Native', firstName: 'Alex', lastName: 'Test', password: 'Password1!', phone: '',
        } });
        expect(result).toEqual(expect.objectContaining({ trialEndDate: expiry, checkoutUrl: null }));
        expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
          saasPlan: plan, saasPlanUntil: new Date(expiry),
          saasPlanDetails: { create: expect.objectContaining({ currentPlan: plan, planStatus: 'TRIAL', trialEndDate: new Date(expiry), nextPaymentDate: null }) },
        }) }));
        expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
      } finally { jest.useRealTimers(); }
    });

    it.each(['saasPlan', 'checkoutPlan'])('rejects Business in %s for independent accounts', async (field) => {
      const result = await service.register({ registerBody: {
        email: 'artist@example.com', role: 'user_tatoueur', firstName: 'Alex', lastName: 'Test', phone: '', password: 'Password1!', [field]: 'BUSINESS',
      } });
      expect(result).toEqual(expect.objectContaining({ error: true, message: 'Le plan Business est réservé aux comptes salon.' }));
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('returns error when user with email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      const result = await service.register({
        registerBody: {
          email: 'existing@example.com',
          role: 'user_salon',
          salonName: 'Salon Test',
          saasPlan: 'FREE',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe',
          phone: '0612345678',
        },
      });

      expect(result).toEqual({
        error: true,
        message: 'Un compte existe déjà avec cet email.',
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates salon user with hashed password and sends emails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-salon-1',
        email: 'newsalon@example.com',
        salonName: 'New Tattoo Studio',
        saasPlan: 'PRO',
        firstName: 'Alice',
        lastName: 'Martin',
        phone: '0787654321',
        password: 'hashed-password123',
      });

      const result = await service.register({
        registerBody: {
          email: 'newsalon@example.com',
          role: 'user_salon',
          salonName: 'New Tattoo Studio',
          saasPlan: 'PRO',
          password: 'password123',
          firstName: 'Alice',
          lastName: 'Martin',
          phone: '0787654321',
        },
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newsalon@example.com',
            salonName: 'New Tattoo Studio',
            password: 'hashed-password123',
            firstName: 'Alice',
            lastName: 'Martin',
            phone: '0787654321',
            saasPlan: 'PRO',
          }),
        }),
      );
      expect(mail.sendAdminNewUserNotification).toHaveBeenCalled();
      expect(prisma.verificationToken.create).toHaveBeenCalled();
      expect(mail.sendEmailVerification).toHaveBeenCalled();
      expect(result).toEqual({
        message:
          'Votre compte a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.',
        trialEndDate: null,
        checkoutUrl: null,
        checkoutError: null,
      });
    });

    it('returns checkout url when a checkout plan is requested', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-salon-2',
        email: 'checkout@example.com',
        salonName: 'Checkout Studio',
        saasPlan: 'FREE',
        firstName: 'Chloe',
        lastName: 'Martin',
        phone: '0712345678',
      });
      stripe.createCheckoutSession.mockResolvedValue(
        'https://checkout.stripe.test/session_123',
      );

      const result = await service.register({
        registerBody: {
          email: 'checkout@example.com',
          role: 'user_salon',
          salonName: 'Checkout Studio',
          saasPlan: 'FREE',
          checkoutPlan: 'PRO',
          password: 'password123',
          firstName: 'Chloe',
          lastName: 'Martin',
          phone: '0712345678',
        },
      });

      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        'new-salon-2',
        'PRO',
      );
      expect(result).toEqual({
        message:
          'Votre compte a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.',
        trialEndDate: null,
        checkoutUrl: 'https://checkout.stripe.test/session_123',
        checkoutError: null,
      });
    });

    it('sends correct verification email with token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'salon1',
        email: 'test@example.com',
        salonName: 'Test Salon',
        saasPlan: 'FREE',
        firstName: 'Test',
        lastName: 'User',
        phone: '0123456789',
      });
      prisma.verificationToken.create.mockImplementation((opts: any) => {
        expect(opts.data.token).toBeDefined();
        expect(opts.data.expires).toBeDefined();
        return Promise.resolve(opts.data);
      });

      await service.register({
        registerBody: {
          email: 'test@example.com',
          role: 'user_salon',
          salonName: 'Test Salon',
          saasPlan: 'FREE',
          password: 'pwd123',
          firstName: 'Test',
          lastName: 'User',
          phone: '0123456789',
        },
      });

      expect(mail.sendEmailVerification).toHaveBeenCalledWith(
        'test@example.com',
        expect.objectContaining({
          verificationUrl: expect.stringContaining('?token='),
        }),
        'Test Salon',
      );
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION REGISTERCLIENT
  // ============================================================================

  describe('registerClient()', () => {
    it('returns error when user already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-client' });

      const result = await service.registerClient({
        registerBody: {
          email: 'client@example.com',
          password: 'password123',
          firstName: 'Jean',
          lastName: 'Client',
          birthDate: '1995-05-15',
          confirmPassword: 'password123',
        },
      });

      expect(result).toEqual({
        error: true,
        message: 'Un compte existe déjà avec cet email.',
      });
    });

    it('returns error when passwords do not match', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.registerClient({
        registerBody: {
          email: 'newclient@example.com',
          password: 'password123',
          firstName: 'Marie',
          lastName: 'Dupont',
          birthDate: '1990-03-20',
          confirmPassword: 'different_password',
        },
      });

      expect(result).toEqual({
        error: true,
        message: 'Les mots de passe ne correspondent pas.',
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates client user with profile and sends verification email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'client-new-1',
        email: 'newclient@example.com',
        firstName: 'Marie',
        lastName: 'Dupont',
        password: 'hashed-password123',
        role: 'client',
        clientProfile: {
          id: 'cp1',
          userId: 'client-new-1',
          birthDate: new Date('1990-03-20'),
        },
      });

      const result = await service.registerClient({
        registerBody: {
          email: 'newclient@example.com',
          password: 'password123',
          firstName: 'Marie',
          lastName: 'Dupont',
          birthDate: '1990-03-20',
          confirmPassword: 'password123',
        },
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newclient@example.com',
            role: 'client',
            clientProfile: expect.any(Object),
          }),
        }),
      );
      expect(prisma.verificationToken.create).toHaveBeenCalled();
      expect(mail.sendClientEmailVerification).toHaveBeenCalled();
      expect(result).toEqual({
        message:
          'Votre compte client a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.',
      });
    });

    it('creates client without birthDate when not provided', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'client-no-birth',
        email: 'client@example.com',
        firstName: 'Jean',
        lastName: 'Martin',
        password: 'hashed-pwd',
        role: 'client',
        clientProfile: {
          id: 'cp2',
          userId: 'client-no-birth',
          birthDate: null,
        },
      });

      const result = await service.registerClient({
        registerBody: {
          email: 'client@example.com',
          password: 'password123',
          firstName: 'Jean',
          lastName: 'Martin',
          birthDate: '',
          confirmPassword: 'password123',
        } as any,
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientProfile: expect.any(Object),
          }),
        }),
      );
      expect(result).toHaveProperty('message');
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION SENDRESETPASSWORDEMAIL
  // ============================================================================

  describe('sendResetPasswordEmail()', () => {
    it('returns message without error when user not found (security)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.sendResetPasswordEmail(
        'nonexistent@example.com',
      );

      expect(result).toEqual({
        message:
          'Si un compte existe avec cette adresse, un email a été envoyé.',
      });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('creates password reset token and sends email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        salonName: 'Salon Test',
        password: 'hashed',
      });

      const result = await service.sendResetPasswordEmail('user@example.com');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'user@example.com',
            token: expect.any(String),
            expires: expect.any(Date),
          }),
        }),
      );
      expect(mail.sendPasswordReset).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({ resetUrl: expect.any(String) }),
        'Salon Test',
      );
      expect(result).toEqual({
        message:
          'Si un compte existe avec cette adresse, un email a été envoyé.',
      });
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION RESETPASSWORD
  // ============================================================================

  describe('resetPassword()', () => {
    it('returns error when reset token not found', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      try {
        await service.resetPassword({
          email: 'user@example.com',
          token: 'invalid-token',
          password: 'newpassword123',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe(
          'Lien invalide ou expiré.',
        );
      }
    });

    it('returns error when reset token is expired', async () => {
      const now = new Date();
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        email: 'user@example.com',
        token: 'a'.repeat(64),
        expires: new Date(now.getTime() - 1000), // 1 second ago
      });

      try {
        await service.resetPassword({
          email: 'user@example.com',
          token: 'a'.repeat(64),
          password: 'newpassword123',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe(
          'Lien invalide ou expiré.',
        );
      }
    });

    it('resets password with valid token', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 10);
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        email: 'user@example.com',
        token: 'a'.repeat(64),
        expires: futureDate,
      });
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-newpassword123',
      });

      const result = await service.resetPassword({
        email: 'user@example.com',
        token: 'a'.repeat(64),
        password: 'newpassword123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        data: { password: 'hashed-newpassword123' },
      });
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'token-1', email: 'user@example.com', token: expect.stringMatching(/^sha256:/), expires: expect.any(Object) }),
      });
      expect(result).toEqual({
        message: 'Mot de passe mis à jour avec succès.',
      });
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION CHANGEPASSWORD
  // ============================================================================

  describe('changePassword()', () => {
    it('returns error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      try {
        await service.changePassword({
          userId: 'nonexistent',
          currentPassword: 'oldpwd',
          newPassword: 'newpwd',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Utilisateur non trouvé.');
      }
    });

    it('returns error when current password is incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-oldpwd',
        salonName: 'Salon',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      try {
        await service.changePassword({
          userId: 'u1',
          currentPassword: 'wrongpwd',
          newPassword: 'newpwd123',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Mot de passe actuel incorrect.');
      }
    });

    it('returns error when new password is the same as current', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-pwd',
        salonName: 'Salon',
      });

      try {
        await service.changePassword({
          userId: 'u1',
          currentPassword: 'password123',
          newPassword: 'password123',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe(
          "Le nouveau mot de passe doit être différent de l'ancien.",
        );
      }
    });

    it('returns error when new password is too short', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-pwd',
        salonName: 'Salon',
      });

      try {
        await service.changePassword({
          userId: 'u1',
          currentPassword: 'password123',
          newPassword: 'short',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe(
          'Le mot de passe doit contenir au moins 6 caractères.',
        );
      }
    });

    it('changes password successfully and sends confirmation email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-oldpwd',
        salonName: 'Salon Test',
      });
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-newpassword123',
        salonName: 'Salon Test',
      });

      const result = await service.changePassword({
        userId: 'u1',
        currentPassword: 'password123',
        newPassword: 'newpassword123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { password: 'hashed-newpassword123' },
      });
      expect(mail.sendPasswordChangeConfirmation).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({ recipientName: expect.any(String) }),
        'Salon Test',
      );
      expect(result).toEqual({ message: 'Mot de passe changé avec succès.' });
    });
  });

  // ============================================================================
  // TESTS POUR LA CONNEXION GOOGLE
  // ============================================================================

  describe('loginWithGoogle()', () => {
    const identity = {
      subject: 'google-subject',
      email: 'verified@gmail.com',
      firstName: 'Verified',
      lastName: 'User',
      image: null,
      isEmailAuthoritative: true,
    };
    const existing = {
      id: 'existing-user',
      email: identity.email,
      role: 'client',
      emailVerified: new Date(),
      googleSubject: null,
      clientProfile: { id: 'profile', userId: 'existing-user' },
    };

    beforeEach(() => {
      googleIdentity.verify.mockResolvedValue(identity);
    });

    it('never reads accounts or issues a JWT when Google verification fails', async () => {
      googleIdentity.verify.mockRejectedValue(new UnauthorizedException());
      await expect(
        service.loginWithGoogle({ idToken: 'forged' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('looks up the verified subject before email and supports subsequent email changes', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...existing,
        email: 'original@example.test',
        googleSubject: identity.subject,
      });
      const result = await service.loginWithGoogle({ idToken: 'signed' });
      expect(googleIdentity.verify).toHaveBeenCalledWith('signed');
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { googleSubject: identity.subject } }),
      );
      expect(result).toMatchObject({
        id: existing.id,
        email: 'original@example.test',
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('links an existing account only after Google establishes email ownership', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.loginWithGoogle({ idToken: 'signed' });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: existing.id, googleSubject: null },
        data: { googleSubject: identity.subject },
      });
      expect(result).toMatchObject({
        id: existing.id,
        access_token: 'jwt-token',
        role: 'client',
      });
    });

    it('can verify a previously unverified local email only after authoritative Google verification', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...existing, emailVerified: null });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      await service.loginWithGoogle({ idToken: 'signed' });
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            googleSubject: identity.subject,
            emailVerified: expect.any(Date),
            password: '',
          },
        }),
      );
    });

    it('refuses email-only linking for third-party addresses', async () => {
      googleIdentity.verify.mockResolvedValue({
        ...identity,
        isEmailAuthoritative: false,
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      await expect(
        service.loginWithGoogle({ idToken: 'signed' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('never replaces a different linked Google identity', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...existing,
          googleSubject: 'different-subject',
        });
      await expect(
        service.loginWithGoogle({ idToken: 'signed' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('does not issue a JWT if another request already linked the account', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.loginWithGoogle({ idToken: 'signed' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('creates a client from verified claims and ignores injected identity fields', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        ...existing,
        googleSubject: identity.subject,
      });
      await service.loginWithGoogle({
        idToken: 'signed',
        email: 'admin@example.test',
        role: 'admin',
        firstName: 'Injected',
      } as any);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: identity.email,
            googleSubject: identity.subject,
            firstName: identity.firstName,
            role: 'client',
            emailVerified: expect.any(Date),
          }),
        }),
      );
      expect(jwt.sign).toHaveBeenCalledWith({
        userId: existing.id,
        role: 'client',
      });
    });

    it('preserves an existing role from the database rather than accepting a requested role', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...existing,
        googleSubject: identity.subject,
      });
      await service.loginWithGoogle({ idToken: 'signed', role: 'admin' } as any);
      expect(jwt.sign).toHaveBeenCalledWith({
        userId: existing.id,
        role: 'client',
      });
    });
  });

});
