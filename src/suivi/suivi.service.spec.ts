import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DrawingCardStatus, PrestationType } from '@prisma/client';
import { SuiviService } from './suivi.service';

const createPrismaMock = () => ({
  user: { findUnique: jest.fn().mockResolvedValue({ role: 'user_salon' }) },
  $queryRaw: jest.fn().mockResolvedValue([]),
  $transaction: jest.fn(),
  appointment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  drawingCard: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  drawingCardNote: { create: jest.fn() },
  drawingCardImage: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
});

describe('SuiviService', () => {
  let service: SuiviService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(async callback => callback(prisma));
    service = new SuiviService(prisma as never);
  });

  it('refuse une card depuis un rendez-vous inaccessible', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      id: 'appointment-1',
      userId: 'salon-1',
      performerUserId: null,
      prestation: PrestationType.PROJET,
      status: 'COMPLETED',
    });

    await expect(
      service.getAppointmentCardStatus('appointment-1', 'autre-user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('crée une card avec les informations du rendez-vous et du moodboard', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      id: 'appointment-1',
      userId: 'salon-1',
      performerUserId: 'tatoueur-1',
      prestation: PrestationType.PROJET,
      title: 'Projet floral',
      clientId: 'client-1',
      clientUserId: null,
      tatoueurId: null,
      tattooDetail: { description: 'Fleurs sur avant-bras' },
      moodboard: {
        images: [{ url: 'https://example.com/ref.png', caption: 'Reference' }],
      },
    });
    prisma.drawingCard.findUnique.mockResolvedValue(null);
    prisma.drawingCard.create.mockResolvedValue({ id: 'card-1' });

    await service.createCard('salon-1', {
      sourceAppointmentId: 'appointment-1',
    });

    expect(prisma.drawingCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Projet floral',
          description: 'Fleurs sur avant-bras',
          images: expect.objectContaining({
            create: [
              expect.objectContaining({
                url: 'https://example.com/ref.png',
                caption: 'Reference',
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('refuse de relier une card qui n’est pas approuvée', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      id: 'card-1',
      salonId: 'salon-1',
      performerUserId: null,
      status: DrawingCardStatus.EN_COURS,
    });

    await expect(
      service.linkTattooAppointment('card-1', 'appointment-1', 'salon-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crée une nouvelle version d’image', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      id: 'card-1',
      salonId: 'salon-1',
      performerUserId: null,
    });
    prisma.drawingCardImage.findFirst.mockResolvedValue({ version: 2 });
    prisma.drawingCardImage.create.mockResolvedValue({
      id: 'image-3',
      version: 3,
    });

    await service.addImage('card-1', 'salon-1', {
      url: 'https://example.com/v3.png',
    });

    expect(prisma.drawingCardImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 3 }),
      }),
    );
  });

  it('applique les filtres de statut, de recherche et de période', async () => {
    prisma.drawingCard.findMany.mockResolvedValue([]);

    await service.getCards('salon-1', {
      status: DrawingCardStatus.A_MODIFIER,
      search: 'Dupont',
      tatoueurId: 'tatoueur-1',
      appointmentDateFrom: '2026-01-01T00:00:00.000Z',
      appointmentDateTo: '2026-01-31T23:59:59.000Z',
    });

    expect(prisma.drawingCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: DrawingCardStatus.A_MODIFIER,
          sourceAppointment: expect.objectContaining({
            start: expect.any(Object),
          }),
          AND: expect.any(Array),
        }),
      }),
    );
  });

  it('modifie la légende et supprime une image de la bonne card', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      id: 'card-1',
      salonId: 'salon-1',
      performerUserId: null,
    });
    prisma.drawingCardImage.findFirst.mockResolvedValue({
      id: 'image-1',
      cardId: 'card-1',
    });
    prisma.drawingCardImage.update.mockResolvedValue({
      id: 'image-1',
      caption: 'Nouvelle légende',
    });

    await service.updateImageCaption('card-1', 'image-1', 'salon-1', {
      caption: 'Nouvelle légende',
    });
    await service.deleteImage('card-1', 'image-1', 'salon-1');

    expect(prisma.drawingCardImage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'image-1' },
        data: { caption: 'Nouvelle légende' },
      }),
    );
    expect(prisma.drawingCardImage.delete).toHaveBeenCalledWith({
      where: { id: 'image-1' },
    });
  });

  it('supprime une card accessible et ses relations', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      id: 'card-1',
      salonId: 'salon-1',
      performerUserId: null,
    });
    prisma.drawingCard.delete.mockResolvedValue({ id: 'card-1' });

    const result = await service.deleteCard('card-1', 'salon-1');

    expect(result.message).toContain('supprimée');
    expect(prisma.drawingCard.delete).toHaveBeenCalledWith({
      where: { id: 'card-1' },
    });
  });
});
