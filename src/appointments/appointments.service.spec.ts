/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { FollowupSchedulerService } from 'src/follow-up/followup-scheduler.service';
import { SaasService } from 'src/saas/saas.service';
import { VideoCallService } from 'src/video-call/video-call.service';
import { CacheService } from 'src/redis/cache.service';
import { ConversationsService } from 'src/messaging/conversations/conversations.service';
import { PrestationType } from './dto/create-appointment.dto';

const createPrismaMock = () => ({
  appointment: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  tatoueur: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  client: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  tattooDetail: {
    create: jest.fn(),
  },
  piercingServicePrice: {
    findUnique: jest.fn(),
  },
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
});

const createMailServiceMock = () => ({
  sendAppointmentConfirmation: jest.fn(),
  sendPendingAppointmentNotification: jest.fn(),
  sendAutoConfirmedAppointment: jest.fn(),
  sendNewAppointmentNotification: jest.fn(),
  sendAppointmentModification: jest.fn(),
  sendCustomEmail: jest.fn(),
});

const createVideoCallServiceMock = () => ({
  generateVideoCallLink: jest.fn(),
});

const createConversationsServiceMock = () => ({
  createConversation: jest.fn(),
});

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;
  let mailService: ReturnType<typeof createMailServiceMock>;
  let videoCallService: ReturnType<typeof createVideoCallServiceMock>;
  let conversationsService: ReturnType<typeof createConversationsServiceMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();
    mailService = createMailServiceMock();
    videoCallService = createVideoCallServiceMock();
    conversationsService = createConversationsServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
        { provide: FollowupSchedulerService, useValue: {} },
        { provide: SaasService, useValue: {} },
        { provide: VideoCallService, useValue: videoCallService },
        { provide: CacheService, useValue: cache },
        { provide: ConversationsService, useValue: conversationsService },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    jest.clearAllMocks();
  });

  // ============================================================================
  // TESTS POUR LA FONCTION CREATE
  // ============================================================================

  describe('create()', () => {
    const userId = 'salon-123';
    const tatoueurId = 'tatoueur-456';
    const clientEmail = 'client@example.com';

    const createAppointmentDto = {
      title: 'Tatouage Personnalisé',
      prestation: PrestationType.TATTOO,
      start: '2025-02-01T10:00:00Z',
      end: '2025-02-01T12:00:00Z',
      clientFirstname: 'Jean',
      clientLastname: 'Dupont',
      clientEmail,
      clientPhone: '0612345678',
      clientBirthdate: '1990-05-15',
      tatoueurId,
      visio: false,
      zone: 'bras',
      size: 'medium',
      colorStyle: 'noir et gris',
      price: 150,
    };

    it('should return error when tatoueur does not exist', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue(null);

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toBe('Tatoueur introuvable.');
      expect(prisma.tatoueur.findUnique).toHaveBeenCalledWith({
        where: { id: tatoueurId },
      });
    });

    it('should return error when time slot is already booked', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'apt-existing',
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        status: 'CONFIRMED',
      });

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toBe('Ce créneau horaire est déjà réservé.');
    });

    it('should create appointment with new client (not connected)', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio Pro' }); // salon lookup
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-789',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        phone: '0612345678',
        birthDate: new Date('1990-05-15'),
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-new-123',
        userId,
        title: createAppointmentDto.title,
        prestation: createAppointmentDto.prestation,
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        tatoueurId,
        clientId: 'client-789',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: false,
        visioRoom: null,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-123',
        appointmentId: 'apt-new-123',
        price: 150,
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(false);
      expect(result.message).toContain('créé');
      expect(result.clientLinked).toBe(false);
      expect(prisma.client.create).toHaveBeenCalled();
      expect(mailService.sendAppointmentConfirmation).toHaveBeenCalled();
      expect(cache.delPattern).toHaveBeenCalledWith(
        `appointments:salon:${userId}:*`,
      );
    });

    it('should create appointment with existing client', async () => {
      const existingClient = {
        id: 'client-existing',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        phone: '0612345678',
        birthDate: new Date('1990-05-15'),
        userId,
        linkedUserId: null,
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio Pro' }); // salon lookup
      prisma.client.findFirst.mockResolvedValue(existingClient);
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-new-456',
        userId,
        title: createAppointmentDto.title,
        prestation: createAppointmentDto.prestation,
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        tatoueurId,
        clientId: existingClient.id,
        clientUserId: null,
        status: 'CONFIRMED',
        visio: false,
        visioRoom: null,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-456',
        appointmentId: 'apt-new-456',
        price: 150,
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(false);
      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(prisma.client.findFirst).toHaveBeenCalled();
      expect(mailService.sendAppointmentConfirmation).toHaveBeenCalled();
    });

    it('should link connected client to appointment', async () => {
      const connectedClient = {
        id: 'client-user-123',
        firstName: 'Jean',
        lastName: 'Dupont',
        phone: '0612345678',
        role: 'client',
        clientProfile: {
          birthDate: new Date('1990-05-15'),
        },
      };

      const clientRecord = {
        id: 'client-record-123',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        phone: '0612345678',
        birthDate: new Date('1990-05-15'),
        userId,
        linkedUserId: null,
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(connectedClient) // clientUser lookup
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio Pro' }); // salon lookup
      prisma.client.findFirst.mockResolvedValue(clientRecord);
      prisma.client.update.mockResolvedValue({
        ...clientRecord,
        linkedUserId: connectedClient.id,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-linked-123',
        userId,
        title: createAppointmentDto.title,
        prestation: createAppointmentDto.prestation,
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        tatoueurId,
        clientId: clientRecord.id,
        clientUserId: connectedClient.id,
        status: 'CONFIRMED',
        visio: false,
        visioRoom: null,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-linked',
        appointmentId: 'apt-linked-123',
        price: 150,
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(false);
      expect(result.clientLinked).toBe(true);
      expect(prisma.client.update).toHaveBeenCalled();
      expect(conversationsService.createConversation).toHaveBeenCalled();
    });

    it('should create tattoo detail for TATTOO prestation', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-789',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-tattoo-123',
        userId,
        title: createAppointmentDto.title,
        prestation: PrestationType.TATTOO,
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        tatoueurId,
        clientId: 'client-789',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: false,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-tattoo',
        appointmentId: 'apt-tattoo-123',
        zone: 'bras',
        size: 'medium',
        colorStyle: 'noir et gris',
        price: 150,
        estimatedPrice: 150,
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-tattoo-123',
        tattooDetailId: 'detail-tattoo',
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(false);
      expect(prisma.tattooDetail.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          zone: 'bras',
          size: 'medium',
          colorStyle: 'noir et gris',
          price: 150,
        }),
      });
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-tattoo-123' },
        data: { tattooDetailId: 'detail-tattoo' },
      });
    });

    it('should create piercing tattoo detail with price from service', async () => {
      const piercingDto = {
        ...createAppointmentDto,
        prestation: PrestationType.PIERCING,
        piercingServicePriceId: 'piercing-service-123',
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-piercing',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.piercingServicePrice.findUnique.mockResolvedValue({
        price: 45,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-piercing-123',
        userId,
        title: piercingDto.title,
        prestation: PrestationType.PIERCING,
        start: new Date(piercingDto.start),
        end: new Date(piercingDto.end),
        tatoueurId,
        clientId: 'client-piercing',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: false,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-piercing',
        appointmentId: 'apt-piercing-123',
        piercingServicePriceId: 'piercing-service-123',
        price: 45,
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-piercing-123',
        tattooDetailId: 'detail-piercing',
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({ userId, rdvBody: piercingDto });

      expect(result.error).toBe(false);
      expect(prisma.piercingServicePrice.findUnique).toHaveBeenCalledWith({
        where: {
          id: 'piercing-service-123',
          userId,
          isActive: true,
        },
        select: { price: true },
      });
      expect(prisma.tattooDetail.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          piercingServicePriceId: 'piercing-service-123',
          price: 45,
        }),
      });
    });

    it('should generate video call link when visio is true and no visioRoom provided', async () => {
      const visioDto = { ...createAppointmentDto, visio: true };
      const generatedLink = 'https://videocall.example.com/room-xyz';

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-visio',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      videoCallService.generateVideoCallLink.mockReturnValue(generatedLink);
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-visio-123',
        userId,
        title: visioDto.title,
        prestation: visioDto.prestation,
        start: new Date(visioDto.start),
        end: new Date(visioDto.end),
        tatoueurId,
        clientId: 'client-visio',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: true,
        visioRoom: generatedLink,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-visio',
        appointmentId: 'apt-visio-123',
        price: 150,
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-visio-123',
        tattooDetailId: 'detail-visio',
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({ userId, rdvBody: visioDto });

      expect(result.error).toBe(false);
      expect(videoCallService.generateVideoCallLink).toHaveBeenCalled();
      expect(prisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visio: true,
            visioRoom: generatedLink,
          }),
        }),
      );
    });

    it('should use provided visioRoom when visio is true', async () => {
      const visioDto = {
        ...createAppointmentDto,
        visio: true,
        visioRoom: 'https://custom.room.link',
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-visio-custom',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-visio-custom-123',
        userId,
        title: visioDto.title,
        prestation: visioDto.prestation,
        start: new Date(visioDto.start),
        end: new Date(visioDto.end),
        tatoueurId,
        clientId: 'client-visio-custom',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: true,
        visioRoom: 'https://custom.room.link',
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-visio-custom',
        appointmentId: 'apt-visio-custom-123',
        price: 150,
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-visio-custom-123',
        tattooDetailId: 'detail-visio-custom',
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({ userId, rdvBody: visioDto });

      expect(result.error).toBe(false);
      expect(videoCallService.generateVideoCallLink).not.toHaveBeenCalled();
      expect(prisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visio: true,
            visioRoom: 'https://custom.room.link',
          }),
        }),
      );
    });

    it('should invalidate cache after successful appointment creation', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-cache',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-cache-123',
        userId,
        title: createAppointmentDto.title,
        prestation: createAppointmentDto.prestation,
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        tatoueurId,
        clientId: 'client-cache',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: false,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-cache',
        appointmentId: 'apt-cache-123',
        price: 150,
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-cache-123',
        tattooDetailId: 'detail-cache',
      });
      mailService.sendAppointmentConfirmation.mockResolvedValue(true);

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(false);
      expect(cache.delPattern).toHaveBeenCalledWith(
        `appointments:salon:${userId}:*`,
      );
      expect(cache.delPattern).toHaveBeenCalledWith(
        `appointments:date-range:${userId}:*`,
      );
    });

    it('should handle email sending errors gracefully', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'John Doe',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: userId, salonName: 'Tattoo Studio' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-email-error',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-email-error-123',
        userId,
        title: createAppointmentDto.title,
        prestation: createAppointmentDto.prestation,
        start: new Date(createAppointmentDto.start),
        end: new Date(createAppointmentDto.end),
        tatoueurId,
        clientId: 'client-email-error',
        clientUserId: null,
        status: 'CONFIRMED',
        visio: false,
        tatoueur: { name: 'John Doe' },
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-email-error',
        appointmentId: 'apt-email-error-123',
        price: 150,
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-email-error-123',
        tattooDetailId: 'detail-email-error',
      });
      mailService.sendAppointmentConfirmation.mockRejectedValue(
        new Error('Email service error'),
      );

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      // Should still succeed, but email failed
      expect(result.error).toBe(false);
      expect(result.message).toContain('créé');
      expect(mailService.sendAppointmentConfirmation).toHaveBeenCalled();
    });

    it('should catch general errors and return error response', async () => {
      prisma.tatoueur.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await service.create({
        userId,
        rdvBody: createAppointmentDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toBe('Database error');
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION CREATEBYCLIENT
  // ============================================================================

  describe('createByClient()', () => {
    const userId = 'salon-123';
    const tatoueurId = 'tatoueur-456';
    const clientEmail = 'client@example.com';

    const createByClientDto = {
      title: 'Projet Tatouage Personnalisé',
      prestation: PrestationType.PROJET,
      start: '2025-02-15T14:00:00Z',
      end: '2025-02-15T16:00:00Z',
      clientFirstname: 'Marie',
      clientLastname: 'Martin',
      clientEmail,
      clientPhone: '0687654321',
      clientBirthdate: '1995-03-20',
      tatoueurId,
      visio: false,
      zone: 'épaule',
      size: 'large',
      colorStyle: 'couleur',
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return error when userId is not provided', async () => {
      const result = await service.createByClient({
        userId: undefined as any,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('salon');
    });

    it('should return error when tatoueur does not exist', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue(null);

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('Tatoueur');
    });

    it('should return error when time slot is already booked', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'Jane Artist',
      });
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'existing-apt',
        status: 'CONFIRMED',
      });

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('créneau horaire');
    });

    it('should return error when salon not found', async () => {
      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'Jane Artist',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('Salon');
    });

    it('should create appointment with PENDING status when confirmation enabled', async () => {
      const salonData = {
        id: userId,
        addConfirmationEnabled: true,
        salonName: 'Pro Tattoo',
        email: 'salon@example.com',
        appointmentBookingEnabled: true,
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'Jane Artist',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      // First call: look for clientUser by email -> null (no connected client)
      // Second call: get salon data
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup - no connected client
        .mockResolvedValueOnce(salonData); // salon lookup
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-new-123',
        firstName: 'Marie',
        lastName: 'Martin',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-pending-123',
        userId,
        title: createByClientDto.title,
        prestation: createByClientDto.prestation,
        start: new Date(createByClientDto.start),
        end: new Date(createByClientDto.end),
        status: 'PENDING',
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-pending-123',
        appointmentId: 'apt-pending-123',
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-pending-123',
        tattooDetailId: 'detail-pending-123',
      });
      mailService.sendPendingAppointmentNotification.mockResolvedValue(true);
      mailService.sendNewAppointmentNotification.mockResolvedValue(true);

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(result.message).toContain('confirmation');
    });

    it('should create appointment with CONFIRMED status when confirmation disabled', async () => {
      const salonData = {
        id: userId,
        addConfirmationEnabled: false,
        salonName: 'Quick Tattoo',
        email: 'quick@example.com',
        appointmentBookingEnabled: true,
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'Jane Artist',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      // First call: look for clientUser by email -> null
      // Second call: get salon data
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup
        .mockResolvedValueOnce(salonData); // salon lookup
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-confirmed-123',
        firstName: 'Marie',
        lastName: 'Martin',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-confirmed-123',
        userId,
        title: createByClientDto.title,
        prestation: createByClientDto.prestation,
        start: new Date(createByClientDto.start),
        end: new Date(createByClientDto.end),
        status: 'CONFIRMED',
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-confirmed-123',
        appointmentId: 'apt-confirmed-123',
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-confirmed-123',
        tattooDetailId: 'detail-confirmed-123',
      });
      mailService.sendAutoConfirmedAppointment.mockResolvedValue(true);
      mailService.sendNewAppointmentNotification.mockResolvedValue(true);

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(false);
      expect(result.status).toBe('CONFIRMED');
      expect(result.message).toContain('succès');
    });

    it('should handle appointment without tatoueur', async () => {
      // Cast as any to allow tatoueurId to be undefined while exercising service branch
      const dtoWithoutTatoueur: any = {
        ...createByClientDto,
        tatoueurId: undefined,
      };

      const salonData = {
        id: userId,
        addConfirmationEnabled: false,
        salonName: 'Flexible Tattoo',
        email: 'flexible@example.com',
        appointmentBookingEnabled: true,
      };

      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup
        .mockResolvedValueOnce(salonData); // salon lookup
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-no-tatoueur-123',
        firstName: 'Marie',
        lastName: 'Martin',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-no-tatoueur-123',
        userId,
        title: dtoWithoutTatoueur.title,
        prestation: dtoWithoutTatoueur.prestation,
        start: new Date(dtoWithoutTatoueur.start),
        end: new Date(dtoWithoutTatoueur.end),
        status: 'CONFIRMED',
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-no-tatoueur-123',
        appointmentId: 'apt-no-tatoueur-123',
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-no-tatoueur-123',
        tattooDetailId: 'detail-no-tatoueur-123',
      });
      mailService.sendAutoConfirmedAppointment.mockResolvedValue(true);
      mailService.sendNewAppointmentNotification.mockResolvedValue(true);

      const result = await service.createByClient({
        userId,
        rdvBody: dtoWithoutTatoueur,
      });

      expect(result.error).toBe(false);
      expect(prisma.tatoueur.findUnique).not.toHaveBeenCalled();
    });

    it('should create tattoo detail for PROJET prestation', async () => {
      const salonData = {
        id: userId,
        addConfirmationEnabled: false,
        salonName: 'Tattoo Studio',
        email: 'studio@example.com',
        appointmentBookingEnabled: true,
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'Jane Artist',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup
        .mockResolvedValueOnce(salonData); // salon lookup
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-projet-123',
        firstName: 'Marie',
        lastName: 'Martin',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-projet-123',
        userId,
        title: createByClientDto.title,
        prestation: PrestationType.PROJET,
        start: new Date(createByClientDto.start),
        end: new Date(createByClientDto.end),
        status: 'CONFIRMED',
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-projet-123',
        appointmentId: 'apt-projet-123',
        zone: 'épaule',
        size: 'large',
        colorStyle: 'couleur',
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-projet-123',
        tattooDetailId: 'detail-projet-123',
      });
      mailService.sendAutoConfirmedAppointment.mockResolvedValue(true);
      mailService.sendNewAppointmentNotification.mockResolvedValue(true);

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(false);
      expect(prisma.tattooDetail.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          zone: 'épaule',
          size: 'large',
          colorStyle: 'couleur',
        }),
      });
    });

    it('should handle visio room creation', async () => {
      const visioDto = { ...createByClientDto, visio: true };
      const generatedLink = 'https://video.example.com/room-xyz';

      const salonData = {
        id: userId,
        addConfirmationEnabled: false,
        salonName: 'Tattoo Studio',
        email: 'studio@example.com',
        appointmentBookingEnabled: true,
      };

      prisma.tatoueur.findUnique.mockResolvedValue({
        id: tatoueurId,
        name: 'Jane Artist',
      });
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // clientUser lookup
        .mockResolvedValueOnce(salonData); // salon lookup
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({
        id: 'client-visio-123',
        firstName: 'Marie',
        lastName: 'Martin',
        email: clientEmail,
        userId,
        linkedUserId: null,
      });
      videoCallService.generateVideoCallLink.mockReturnValue(generatedLink);
      prisma.appointment.create.mockResolvedValue({
        id: 'apt-visio-123',
        userId,
        title: visioDto.title,
        prestation: visioDto.prestation,
        start: new Date(visioDto.start),
        end: new Date(visioDto.end),
        status: 'CONFIRMED',
        visio: true,
      });
      prisma.tattooDetail.create.mockResolvedValue({
        id: 'detail-visio-123',
        appointmentId: 'apt-visio-123',
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'apt-visio-123',
        tattooDetailId: 'detail-visio-123',
      });
      mailService.sendAutoConfirmedAppointment.mockResolvedValue(true);
      mailService.sendNewAppointmentNotification.mockResolvedValue(true);

      const result = await service.createByClient({
        userId,
        rdvBody: visioDto,
      });

      expect(result.error).toBe(false);
      expect(videoCallService.generateVideoCallLink).toHaveBeenCalled();
    });

    it('should catch errors and return error response', async () => {
      prisma.tatoueur.findUnique.mockRejectedValue(
        new Error('Tatoueur service error'),
      );

      const result = await service.createByClient({
        userId,
        rdvBody: createByClientDto,
      });

      expect(result.error).toBe(true);
      expect(result.message).toBe('Tatoueur service error');
    });
  });

  // ============================================================================
  // TESTS POUR LA FONCTION UPDATEAPPOINTMENTBYCLIENT
  // ============================================================================

  describe('updateAppointmentByClient()', () => {
    const appointmentId = 'apt-123';
    const clientUserId = 'client-user-1';
    const salonId = 'salon-1';

    const baseExistingAppointment = {
      id: appointmentId,
      userId: salonId,
      clientUserId,
      status: 'CONFIRMED',
      prestation: PrestationType.TATTOO,
      tatoueurId: 'tat-1',
      start: new Date('2025-03-01T10:00:00Z'),
      end: new Date('2025-03-01T11:00:00Z'),
      visio: false,
      visioRoom: null,
      client: {
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'client@example.com',
        phone: '0611223344',
      },
      tatoueur: {
        name: 'Old Artist',
      },
      user: {
        salonName: 'Salon Test',
        email: 'salon@example.com',
        addConfirmationEnabled: true,
      },
    };

    const rdvBody = {
      start: '2025-03-05T10:00:00Z',
      end: '2025-03-05T11:00:00Z',
    };

    it('should return error when appointment is not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      const result = await service.updateAppointmentByClient(
        appointmentId,
        clientUserId,
        rdvBody,
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe('Rendez-vous introuvable.');
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('should return error when client does not own the appointment', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        ...baseExistingAppointment,
        clientUserId: 'another-user',
      });

      const result = await service.updateAppointmentByClient(
        appointmentId,
        clientUserId,
        rdvBody,
      );

      expect(result.error).toBe(true);
      expect(result.message).toContain('pas le droit');
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('should return error when appointment status is not modifiable', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        ...baseExistingAppointment,
        status: 'COMPLETED',
      });

      const result = await service.updateAppointmentByClient(
        appointmentId,
        clientUserId,
        rdvBody,
      );

      expect(result.error).toBe(true);
      expect(result.message).toContain('terminé');
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('should return error when new tatoueur does not exist', async () => {
      prisma.appointment.findUnique.mockResolvedValue(baseExistingAppointment);
      prisma.tatoueur.findUnique.mockResolvedValue(null);

      const result = await service.updateAppointmentByClient(
        appointmentId,
        clientUserId,
        { ...rdvBody, tatoueurId: 'tat-2' },
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe('Tatoueur introuvable.');
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('should update and set status to PENDING when confirmation is enabled', async () => {
      prisma.appointment.findUnique.mockResolvedValue(baseExistingAppointment);
      prisma.appointment.update.mockResolvedValue({
        ...baseExistingAppointment,
        start: new Date(rdvBody.start),
        end: new Date(rdvBody.end),
        status: 'PENDING',
      });
      mailService.sendAppointmentModification.mockResolvedValue(true);
      mailService.sendCustomEmail.mockResolvedValue(true);

      const result = await service.updateAppointmentByClient(
        appointmentId,
        clientUserId,
        rdvBody,
      );

      expect(result.error).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(result.message).toContain('attente');
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: appointmentId },
        data: expect.objectContaining({
          status: 'PENDING',
          tatoueurId: baseExistingAppointment.tatoueurId,
        }),
        include: expect.any(Object),
      });
      expect(mailService.sendAppointmentModification).toHaveBeenCalled();
      expect(mailService.sendCustomEmail).toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalledWith(`appointment:${appointmentId}`);
      expect(cache.delPattern).toHaveBeenCalledWith(
        `appointments:salon:${salonId}:*`,
      );
      expect(cache.delPattern).toHaveBeenCalledWith(
        `appointments:date-range:${salonId}:*`,
      );
      expect(cache.delPattern).toHaveBeenCalledWith(
        `client:appointments:${clientUserId}:*`,
      );
    });

    it('should keep status when confirmation is disabled', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        ...baseExistingAppointment,
        user: {
          ...baseExistingAppointment.user,
          addConfirmationEnabled: false,
        },
      });
      prisma.appointment.update.mockResolvedValue({
        ...baseExistingAppointment,
        user: {
          ...baseExistingAppointment.user,
          addConfirmationEnabled: false,
        },
        start: new Date(rdvBody.start),
        end: new Date(rdvBody.end),
        status: 'CONFIRMED',
      });
      mailService.sendAppointmentModification.mockResolvedValue(true);
      mailService.sendCustomEmail.mockResolvedValue(true);

      const result = await service.updateAppointmentByClient(
        appointmentId,
        clientUserId,
        rdvBody,
      );

      expect(result.error).toBe(false);
      expect(result.status).toBe('CONFIRMED');
      expect(result.message).toContain('succès');
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: appointmentId },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
        include: expect.any(Object),
      });
    });
  });

  it('returns cached date range appointments when present', async () => {
    const cached = {
      error: false,
      appointments: [{ id: 'a1' }],
      pagination: { currentPage: 1 },
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getAppointmentsByDateRange(
      'u1',
      '2024-01-01',
      '2024-01-31',
    );

    expect(result).toEqual(cached);
    expect(prisma.appointment.count).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches date range appointments and caches them', async () => {
    cache.get.mockResolvedValue(null);
    prisma.appointment.count.mockResolvedValue(2);
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'a1', start: new Date('2024-01-02') },
      { id: 'a2', start: new Date('2024-01-03') },
    ]);

    const result = await service.getAppointmentsByDateRange(
      'u1',
      '2024-01-01',
      '2024-01-31',
      1,
      5,
    );

    expect(result.error).toBe(false);
    const success = result as {
      error: false,
      appointments: any[],
      pagination: any,
    };
    expect(success.appointments).toHaveLength(2);
    expect(success.pagination.totalAppointments).toBe(2);
    expect(success.pagination.totalPages).toBe(1);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('returns cached salon appointments when present', async () => {
    const cached = {
      error: false,
      appointments: [{ id: 's1' }],
      pagination: { currentPage: 1 },
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getAllAppointmentsBySalon('salon1');

    expect(result).toEqual(cached);
    expect(prisma.appointment.count).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches salon appointments and caches them', async () => {
    cache.get.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'salon1' });
    prisma.appointment.findMany
      .mockResolvedValueOnce([{ id: 's1' }]) // main query
      .mockResolvedValueOnce([{ prestation: 'TATTOO' }]); // distinct prestations
    prisma.appointment.count.mockResolvedValue(1);
    prisma.tatoueur.findMany.mockResolvedValue([]);

    const result = await service.getAllAppointmentsBySalon('salon1', 1, 5);

    expect(result.error).toBe(false);
    const success = result as {
      error: false,
      appointments: any[],
      pagination: any,
    };
    expect(success.appointments).toHaveLength(1);
    expect(success.pagination.totalAppointments).toBe(1);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('returns empty array when tatoueur appointments query is null', async () => {
    prisma.appointment.findMany.mockResolvedValue(null as any);

    const result = await service.getAppointmentsByTatoueurRange(
      't1',
      '2024-01-01',
      '2024-01-31',
    );

    expect(result).toEqual([]);
  });

  it('returns cached appointment when available', async () => {
    const cached = {
      id: 'a1',
      title: 'Test',
      start: new Date(),
      end: new Date(),
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getOneAppointment('a1');

    expect(result).toEqual(cached);
    expect(prisma.appointment.findUnique).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches one appointment and caches it when not cached', async () => {
    cache.get.mockResolvedValue(null);
    const appointment = {
      id: 'a2',
      title: 'New',
      start: new Date(),
      end: new Date(),
    };
    prisma.appointment.findUnique.mockResolvedValue(appointment as any);

    const result = await service.getOneAppointment('a2');

    expect(result).toEqual(appointment);
    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      appointment,
      600,
    );
  });
});
