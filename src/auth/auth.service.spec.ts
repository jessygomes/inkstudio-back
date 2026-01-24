/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from 'src/email/mailer.service';
import { SaasService } from 'src/saas/saas.service';
import * as bcrypt from 'bcrypt';

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
      expect(result).toEqual({
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
      expect(result).toEqual({
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
    it('returns error when user with email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      const result = await service.register({
        registerBody: {
          email: 'existing@example.com',
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
          'Lien de réinitialisation invalide ou expiré.',
        );
      }
    });

    it('returns error when reset token is expired', async () => {
      const now = new Date();
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        email: 'user@example.com',
        token: 'valid-token',
        expires: new Date(now.getTime() - 1000), // 1 second ago
      });

      try {
        await service.resetPassword({
          email: 'user@example.com',
          token: 'valid-token',
          password: 'newpassword123',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe(
          'Lien de réinitialisation invalide ou expiré.',
        );
      }
    });

    it('resets password with valid token', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 10);
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        email: 'user@example.com',
        token: 'valid-token',
        expires: futureDate,
      });
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: 'hashed-newpassword123',
      });

      const result = await service.resetPassword({
        email: 'user@example.com',
        token: 'valid-token',
        password: 'newpassword123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        data: { password: 'hashed-newpassword123' },
      });
      expect(prisma.passwordResetToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-1' },
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
  // TESTS POUR LA FONCTION VALIDATEGOOGLEUSER
  // ============================================================================

  // describe('validateGoogleUser()', () => {
  //   it('returns existing user when already in database', async () => {
  //     const existingUser = {
  //       id: 'google-u1',
  //       email: 'google@example.com',
  //       firstName: 'Google',
  //       lastName: 'User',
  //       image: 'avatar.jpg',
  //       emailVerified: new Date(),
  //       clientProfile: { id: 'cp1', userId: 'google-u1' },
  //     };
  //     prisma.user.findUnique.mockResolvedValue(existingUser);

  //     await service.validateGoogleUser({
  //       email: 'google@example.com',
  //       firstName: 'Google',
  //       lastName: 'User',
  //       image: 'avatar.jpg',
  //       access_token: 'google-token',
  //     });

  //     expect(result).toEqual(existingUser);
  //     expect(prisma.user.create).not.toHaveBeenCalled();
  //   });

  //   it('verifies email for existing user when not verified', async () => {
  //     const existingUser = {
  //       id: 'google-u1',
  //       email: 'google@example.com',
  //       firstName: 'Google',
  //       lastName: 'User',
  //       emailVerified: null,
  //       clientProfile: { id: 'cp1', userId: 'google-u1' },
  //     };
  //     prisma.user.findUnique.mockResolvedValue(existingUser);
  //     prisma.user.update.mockResolvedValue({
  //       ...existingUser,
  //       emailVerified: new Date(),
  //     });

  //     const result = await service.validateGoogleUser({
  //       email: 'google@example.com',
  //       firstName: 'Google',
  //       lastName: 'User',
  //       image: 'avatar.jpg',
  //       access_token: 'google-token',
  //     });

  //     expect(prisma.user.update).toHaveBeenCalledWith({
  //       where: { id: 'google-u1' },
  //       data: { emailVerified: expect.any(Date) },
  //     });
  //   });

  //   it('creates new client user from Google OAuth', async () => {
  //     prisma.user.findUnique.mockResolvedValue(null);
  //     prisma.user.create.mockResolvedValue({
  //       id: 'new-google-u1',
  //       email: 'newgoogle@example.com',
  //       firstName: 'New',
  //       lastName: 'GoogleUser',
  //       image: 'newavatar.jpg',
  //       password: '',
  //       role: 'client',
  //       emailVerified: new Date(),
  //       clientProfile: {
  //         id: 'cp-new',
  //         userId: 'new-google-u1',
  //       },
  //     });

  //     const result = await service.validateGoogleUser({
  //       email: 'newgoogle@example.com',
  //       firstName: 'New',
  //       lastName: 'GoogleUser',
  //       image: 'newavatar.jpg',
  //       access_token: 'google-token',
  //     });

  //     expect(prisma.user.create).toHaveBeenCalledWith(
  //       expect.objectContaining({
  //         data: expect.objectContaining({
  //           email: 'newgoogle@example.com',
  //           firstName: 'New',
  //           lastName: 'GoogleUser',
  //           image: 'newavatar.jpg',
  //           role: 'client',
  //           password: '',
  //           emailVerified: expect.any(Date),
  //           clientProfile: expect.any(Object),
  //         }),
  //       }),
  //     );
  //     expect(result).toEqual(
  //       expect.objectContaining({
  //         email: 'newgoogle@example.com',
  //         role: 'client',
  //       }),
  //     );
  //   });

  //   it('creates Google user with empty password and verified email', async () => {
  //     prisma.user.findUnique.mockResolvedValue(null);
  //     prisma.user.create.mockResolvedValue({
  //       id: 'google-u2',
  //       email: 'google2@example.com',
  //       firstName: 'GoogleUser',
  //       lastName: 'Test',
  //       image: undefined,
  //       password: '',
  //       role: 'client',
  //       emailVerified: new Date(),
  //       clientProfile: { id: 'cp2', userId: 'google-u2' },
  //     });

  //     await service.validateGoogleUser({
  //       email: 'google2@example.com',
  //       firstName: 'GoogleUser',
  //       lastName: 'Test',
  //       access_token: 'google-token',
  //     });

  //     expect(prisma.user.create).toHaveBeenCalledWith({
  //       data: expect.objectContaining({
  //         password: '',
  //         emailVerified: expect.any(Date),
  //       }),
  //       include: { clientProfile: true },
  //     });
  //   });
  // });
});
