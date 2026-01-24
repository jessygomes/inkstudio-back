/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mailer.service';
import { MailgunService, MailgunResponse } from './mailgun.service';
import {
  EmailTemplateService,
  EmailTemplateData,
} from './email-template.service';
import { PrismaService } from '../database/prisma.service';

// Mock factories
const createMailgunServiceMock = () => ({
  sendEmail: jest.fn().mockResolvedValue({
    id: '<20260124123456.abcd1234@inkera-studio.com>',
    message: 'Queued. Thank you.',
  }),
});

const createEmailTemplateServiceMock = () => ({
  generateAdminNewUserNotificationEmail: jest
    .fn()
    .mockReturnValue('<html>Admin notification</html>'),
  generateAppointmentConfirmationEmail: jest
    .fn()
    .mockReturnValue('<html>Confirmation</html>'),
  generateNewAppointmentNotificationEmail: jest
    .fn()
    .mockReturnValue('<html>New appointment</html>'),
  generateEmailVerificationEmail: jest
    .fn()
    .mockReturnValue('<html>Email verification</html>'),
  generateClientEmailVerificationEmail: jest
    .fn()
    .mockReturnValue('<html>Client email verification</html>'),
  generatePasswordResetEmail: jest
    .fn()
    .mockReturnValue('<html>Password reset</html>'),
  generatePasswordChangeConfirmationEmail: jest
    .fn()
    .mockReturnValue('<html>Password change</html>'),
  generateFollowUpEmail: jest.fn().mockReturnValue('<html>Follow up</html>'),
  generateFollowUpResponseEmail: jest
    .fn()
    .mockReturnValue('<html>Follow up response</html>'),
  generateCicatrisationFollowUpEmail: jest
    .fn()
    .mockReturnValue('<html>Cicatrisation</html>'),
  generateRetouchesReminderEmail: jest
    .fn()
    .mockReturnValue('<html>Retouches</html>'),
  generateFeedbackRequestEmail: jest
    .fn()
    .mockReturnValue('<html>Feedback</html>'),
  generateAppointmentModificationEmail: jest
    .fn()
    .mockReturnValue('<html>Modification</html>'),
  generateAppointmentCancellationEmail: jest
    .fn()
    .mockReturnValue('<html>Cancellation</html>'),
  generateCustomEmail: jest.fn().mockReturnValue('<html>Custom</html>'),
  generatePendingAppointmentNotificationEmail: jest
    .fn()
    .mockReturnValue('<html>Pending</html>'),
  generateAutoConfirmedAppointmentEmail: jest
    .fn()
    .mockReturnValue('<html>Auto confirmed</html>'),
  generateRescheduleProposalEmail: jest
    .fn()
    .mockReturnValue('<html>Reschedule proposal</html>'),
  generateRescheduleAcceptedNotificationEmail: jest
    .fn()
    .mockReturnValue('<html>Reschedule accepted</html>'),
  generateRescheduleConfirmationEmail: jest
    .fn()
    .mockReturnValue('<html>Reschedule confirmation</html>'),
  generateClientCancellationNotificationEmail: jest
    .fn()
    .mockReturnValue('<html>Client cancellation</html>'),
  generateClientCancellationConfirmationEmail: jest
    .fn()
    .mockReturnValue('<html>Client cancellation confirmation</html>'),
});

const createPrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
});

// Test data builders
const buildEmailTemplateData = (
  overrides?: Partial<EmailTemplateData>,
): EmailTemplateData => ({
  recipientName: 'Jean Dupont',
  salonName: 'Tattoo Studio',
  ...overrides,
});

const buildMailgunResponse = (
  overrides?: Partial<MailgunResponse>,
): MailgunResponse => ({
  id: '<20260124123456.abcd1234@inkera-studio.com>',
  message: 'Queued. Thank you.',
  ...overrides,
});

const buildUserWithColors = (overrides?: Partial<any>) => ({
  id: 'user-1',
  colorProfile: '#FF5733',
  colorProfileBis: '#33FF57',
  ...overrides,
});

describe('MailService', () => {
  let service: MailService;
  let mailgunService: ReturnType<typeof createMailgunServiceMock>;
  let emailTemplateService: ReturnType<typeof createEmailTemplateServiceMock>;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    mailgunService = createMailgunServiceMock();
    emailTemplateService = createEmailTemplateServiceMock();
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: MailgunService,
          useValue: mailgunService,
        },
        {
          provide: EmailTemplateService,
          useValue: emailTemplateService,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMail', () => {
    it('should send email with default domain and sender', async () => {
      const result = await service.sendMail(
        'user@example.com',
        'Test Subject',
        '<html>Test</html>',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(mailgunService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Test Subject',
          html: '<html>Test</html>',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          from: expect.stringContaining('Tattoo Studio'),
        }),
      );
    });

    it('should send email with custom sender name', async () => {
      const result = await service.sendMail(
        'user@example.com',
        'Test Subject',
        '<html>Test</html>',
        'Custom Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(mailgunService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          from: expect.stringContaining('Custom Salon'),
        }),
      );
    });

    it('should send email with custom reply-to address', async () => {
      const result = await service.sendMail(
        'user@example.com',
        'Test Subject',
        '<html>Test</html>',
        'Salon Name',
        'reply@example.com',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(mailgunService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          'h:Reply-To': 'reply@example.com',
        }),
      );
    });

    it('should use default reply-to if not provided', async () => {
      await service.sendMail(
        'user@example.com',
        'Test Subject',
        '<html>Test</html>',
      );

      expect(mailgunService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          'h:Reply-To': expect.stringContaining('noreply@'),
        }),
      );
    });

    it('should handle mailgun service errors', async () => {
      mailgunService.sendEmail.mockRejectedValue(new Error('Mailgun error'));

      await expect(
        service.sendMail(
          'user@example.com',
          'Test Subject',
          '<html>Test</html>',
        ),
      ).rejects.toThrow('Mailgun error');
    });
  });

  describe('sendAdminNewUserNotification', () => {
    it('should send admin notification for new user', async () => {
      const userData = {
        userEmail: 'newsalon@example.com',
        salonName: 'New Salon',
        saasPlan: 'PREMIUM',
        registrationDate: '2026-01-24',
        firstName: 'Jean',
        lastName: 'Dupont',
        phone: '06 12 34 56 78',
      };

      const result = await service.sendAdminNewUserNotification(userData);

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateAdminNewUserNotificationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientName: 'Admin',
          salonName: 'Inkera Studio - Admin',
        }),
      );
      expect(mailgunService.sendEmail).toHaveBeenCalled();
    });

    it('should handle optional user fields', async () => {
      const userData = {
        userEmail: 'newsalon@example.com',
        salonName: 'New Salon',
        saasPlan: 'BASIC',
        registrationDate: '2026-01-24',
      };

      await service.sendAdminNewUserNotification(userData);

      expect(
        emailTemplateService.generateAdminNewUserNotificationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendAppointmentConfirmation', () => {
    it('should send appointment confirmation without salon colors', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendAppointmentConfirmation(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateAppointmentConfirmationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          salonName: 'My Salon',
        }),
      );
    });

    it('should retrieve and include salon colors if userId provided', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      await service.sendAppointmentConfirmation(
        'client@example.com',
        data,
        'My Salon',
        'salon@example.com',
        'user-1',
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { colorProfile: true, colorProfileBis: true },
      });
      expect(
        emailTemplateService.generateAppointmentConfirmationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: '#FF5733',
          colorProfileBis: '#33FF57',
        }),
      );
    });

    it('should handle color retrieval failure gracefully', async () => {
      const data = buildEmailTemplateData();

      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.sendAppointmentConfirmation(
        'client@example.com',
        data,
        'My Salon',
        'salon@example.com',
        'user-1',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateAppointmentConfirmationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendNewAppointmentNotification', () => {
    it('should send new appointment notification', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendNewAppointmentNotification(
        'salon@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateNewAppointmentNotificationEmail,
      ).toHaveBeenCalled();
    });

    it('should include salon colors when userId is provided', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      await service.sendNewAppointmentNotification(
        'salon@example.com',
        data,
        'My Salon',
        'user-1',
      );

      expect(
        emailTemplateService.generateNewAppointmentNotificationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: '#FF5733',
          colorProfileBis: '#33FF57',
        }),
      );
    });
  });

  describe('sendEmailVerification', () => {
    it('should send email verification for salon', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendEmailVerification(
        'salon@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateEmailVerificationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendClientEmailVerification', () => {
    it('should send email verification for client', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendClientEmailVerification(
        'client@example.com',
        data,
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateClientEmailVerificationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendPasswordReset(
        'user@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generatePasswordResetEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendPasswordChangeConfirmation', () => {
    it('should send password change confirmation', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendPasswordChangeConfirmation(
        'user@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generatePasswordChangeConfirmationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendFollowUp', () => {
    it('should send follow-up email', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendFollowUp(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(emailTemplateService.generateFollowUpEmail).toHaveBeenCalled();
    });
  });

  describe('sendFollowUpResponse', () => {
    it('should send follow-up response', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendFollowUpResponse(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateFollowUpResponseEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendCicatrisationFollowUp', () => {
    it('should send cicatrisation follow-up', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendCicatrisationFollowUp(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateCicatrisationFollowUpEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendRetouchesReminder', () => {
    it('should send retouches reminder', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendRetouchesReminder(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateRetouchesReminderEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendFeedbackRequest', () => {
    it('should send feedback request', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendFeedbackRequest(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateFeedbackRequestEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendAppointmentModification', () => {
    it('should send appointment modification email', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendAppointmentModification(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateAppointmentModificationEmail,
      ).toHaveBeenCalled();
    });

    it('should include salon colors when userId is provided', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      await service.sendAppointmentModification(
        'client@example.com',
        data,
        'My Salon',
        'salon@example.com',
        'user-1',
      );

      expect(
        emailTemplateService.generateAppointmentModificationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: '#FF5733',
          colorProfileBis: '#33FF57',
        }),
      );
    });
  });

  describe('sendAppointmentCancellation', () => {
    it('should send appointment cancellation email', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendAppointmentCancellation(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateAppointmentCancellationEmail,
      ).toHaveBeenCalled();
    });

    it('should include salon colors when userId is provided', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      await service.sendAppointmentCancellation(
        'client@example.com',
        data,
        'My Salon',
        'salon@example.com',
        'user-1',
      );

      expect(
        emailTemplateService.generateAppointmentCancellationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: '#FF5733',
          colorProfileBis: '#33FF57',
        }),
      );
    });
  });

  describe('sendCustomEmail', () => {
    it('should send custom email', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendCustomEmail(
        'recipient@example.com',
        'Custom Subject',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(emailTemplateService.generateCustomEmail).toHaveBeenCalled();
    });
  });

  describe('sendPendingAppointmentNotification', () => {
    it('should send pending appointment notification', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendPendingAppointmentNotification(
        'salon@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generatePendingAppointmentNotificationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendAutoConfirmedAppointment', () => {
    it('should send auto-confirmed appointment email', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendAutoConfirmedAppointment(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateAutoConfirmedAppointmentEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendRescheduleProposal', () => {
    it('should send reschedule proposal', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendRescheduleProposal(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateRescheduleProposalEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendRescheduleAcceptedNotification', () => {
    it('should send reschedule accepted notification', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendRescheduleAcceptedNotification(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateRescheduleAcceptedNotificationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendRescheduleConfirmation', () => {
    it('should send reschedule confirmation', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendRescheduleConfirmation(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateRescheduleConfirmationEmail,
      ).toHaveBeenCalled();
    });
  });

  describe('sendClientCancellationNotification', () => {
    it('should send client cancellation notification to salon', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendClientCancellationNotification(
        'salon@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateClientCancellationNotificationEmail,
      ).toHaveBeenCalled();
    });

    it('should include salon colors when userId is provided', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      await service.sendClientCancellationNotification(
        'salon@example.com',
        data,
        'My Salon',
        'user-1',
      );

      expect(
        emailTemplateService.generateClientCancellationNotificationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: '#FF5733',
          colorProfileBis: '#33FF57',
        }),
      );
    });
  });

  describe('sendClientCancellationConfirmation', () => {
    it('should send client cancellation confirmation', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendClientCancellationConfirmation(
        'client@example.com',
        data,
        'My Salon',
      );

      expect(result).toEqual(buildMailgunResponse());
      expect(
        emailTemplateService.generateClientCancellationConfirmationEmail,
      ).toHaveBeenCalled();
    });

    it('should include salon colors when userId is provided', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      await service.sendClientCancellationConfirmation(
        'client@example.com',
        data,
        'My Salon',
        'salon@example.com',
        'user-1',
      );

      expect(
        emailTemplateService.generateClientCancellationConfirmationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: '#FF5733',
          colorProfileBis: '#33FF57',
        }),
      );
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle missing optional salon name', async () => {
      const data = buildEmailTemplateData();

      const result = await service.sendAppointmentConfirmation(
        'client@example.com',
        data,
      );

      expect(result).toEqual(buildMailgunResponse());
    });

    it('should use default colors when user not found', async () => {
      const data = buildEmailTemplateData();

      prisma.user.findUnique.mockResolvedValue(null);

      await service.sendAppointmentConfirmation(
        'client@example.com',
        data,
        'My Salon',
        'salon@example.com',
        'nonexistent-user',
      );

      expect(
        emailTemplateService.generateAppointmentConfirmationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          colorProfile: 'default',
          colorProfileBis: 'default',
        }),
      );
    });

    it('should preserve data integrity across multiple method calls', async () => {
      const data = buildEmailTemplateData({
        recipientName: 'Test User',
        salonName: 'Test Salon',
      });

      await service.sendAppointmentConfirmation(
        'client@example.com',
        data,
        'Test Salon',
      );
      await service.sendNewAppointmentNotification(
        'salon@example.com',
        data,
        'Test Salon',
      );

      expect(
        emailTemplateService.generateAppointmentConfirmationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          salonName: 'Test Salon',
        }),
      );
      expect(
        emailTemplateService.generateNewAppointmentNotificationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          salonName: 'Test Salon',
        }),
      );
    });

    it('should handle all email templates independently', async () => {
      const data = buildEmailTemplateData();

      const results = await Promise.all([
        service.sendAdminNewUserNotification({
          userEmail: 'test@example.com',
          salonName: 'Test',
          saasPlan: 'BASIC',
          registrationDate: '2026-01-24',
        }),
        service.sendEmailVerification('test@example.com', data, 'Test Salon'),
        service.sendPasswordReset('test@example.com', data, 'Test Salon'),
        service.sendFollowUp('test@example.com', data, 'Test Salon'),
        service.sendFeedbackRequest('test@example.com', data, 'Test Salon'),
      ]);

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toEqual(buildMailgunResponse());
      });
    });

    it('should handle empty template data', async () => {
      const emptyData = buildEmailTemplateData({
        recipientName: '',
        salonName: '',
      });

      const result = await service.sendAppointmentConfirmation(
        'client@example.com',
        emptyData,
      );

      expect(result).toEqual(buildMailgunResponse());
    });

    it('should properly construct from address with custom domain', async () => {
      await service.sendMail(
        'user@example.com',
        'Subject',
        '<html></html>',
        'My Salon',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const sendCall = mailgunService.sendEmail.mock.calls[0]?.[0];
      expect(sendCall?.from).toContain('My Salon');
      expect(sendCall?.from).toContain('noreply@');
    });

    it('should handle all appointment-related emails with colors', async () => {
      const data = buildEmailTemplateData();
      const userWithColors = buildUserWithColors();

      prisma.user.findUnique.mockResolvedValue(userWithColors);

      const emailMethods = [
        () =>
          service.sendAppointmentConfirmation(
            'c@ex.com',
            data,
            'S',
            's@ex.com',
            'u-1',
          ),
        () =>
          service.sendAppointmentModification(
            'c@ex.com',
            data,
            'S',
            's@ex.com',
            'u-1',
          ),
        () =>
          service.sendAppointmentCancellation(
            'c@ex.com',
            data,
            'S',
            's@ex.com',
            'u-1',
          ),
        () =>
          service.sendClientCancellationNotification(
            's@ex.com',
            data,
            'S',
            'u-1',
          ),
        () =>
          service.sendClientCancellationConfirmation(
            'c@ex.com',
            data,
            'S',
            's@ex.com',
            'u-1',
          ),
      ];

      await Promise.all(emailMethods.map((method) => method()));

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(5);
    });
  });
});
