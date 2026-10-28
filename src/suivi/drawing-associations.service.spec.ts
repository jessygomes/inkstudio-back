import { SuiviService } from './suivi.service';

describe('Drawing card creation and editable associations', () => {
  let prisma: any;
  let service: SuiviService;
  const card = {
    id: 'card',
    salonId: 'salon',
    clientId: null,
    clientUserId: null,
    sourceAppointmentId: null,
    tattooAppointmentId: null,
    status: 'EN_COURS',
    updatedAt: new Date('2026-10-28T12:00:00Z'),
  };
  const appointment = {
    id: 'rdv',
    userId: 'salon',
    performerUserId: null,
    title: 'Projet floral',
    prestation: 'PROJET',
    clientId: 'client-a',
    clientUserId: null,
    client: null,
  };
  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'user_salon' }),
        findFirst: jest.fn(),
      },
      client: { findFirst: jest.fn() },
      drawingCardImage: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
      appointment: {
        findUnique: jest.fn().mockResolvedValue(appointment),
        findMany: jest.fn().mockResolvedValue([]),
      },
      drawingCard: {
        findUnique: jest.fn().mockResolvedValue(card),
        findUniqueOrThrow: jest.fn().mockResolvedValue(card),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(card),
        update: jest.fn().mockResolvedValue(card),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    service = new SuiviService(prisma);
  });

  it('lists all RDVs of the selected client, including occupied appointments', async () => {
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-a',
      linkedUserId: 'account-a',
    });
    await service.getAppointmentOptions('salon', {
      clientId: 'client-a',
      cardId: 'card',
    });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            { OR: [{ userId: 'salon' }, { performerUserId: 'salon' }] },
            {
              OR: [
                { clientId: 'client-a' },
                { clientUserId: 'account-a' },
                { client: { linkedUserId: 'account-a' } },
              ],
            },
          ]),
        },
        select: expect.objectContaining({
          title: true,
          start: true,
          drawingCardSource: expect.any(Object),
          drawingCardTattoo: expect.any(Object),
        }),
      }),
    );
    const query = prisma.appointment.findMany.mock.calls[0][0];
    expect(query.take).toBeUndefined();
    expect(JSON.stringify(query.where)).not.toContain('drawingCardSource');
  });
  it('requires explicit confirmation for the exact currently linked card', async () => {
    prisma.drawingCard.findFirst.mockResolvedValue({
      id: 'previous-card',
      salonId: 'salon',
      sourceAppointmentId: 'rdv',
    });
    await expect(
      service.updateAssociations('card', 'salon', {
        sourceAppointmentId: 'rdv',
      }),
    ).rejects.toThrow('confirmez le remplacement');
    await expect(
      service.updateAssociations('card', 'salon', {
        sourceAppointmentId: 'rdv',
        replaceSourceCardId: 'stale-previous-card',
      }),
    ).rejects.toThrow('confirmez le remplacement');
    expect(prisma.drawingCard.update).not.toHaveBeenCalled();
  });
  it('replaces the confirmed RDV link while preserving the previous card and its other RDV', async () => {
    prisma.drawingCard.findFirst.mockResolvedValue({
      id: 'previous-card',
      salonId: 'salon',
      sourceAppointmentId: 'other-rdv',
      tattooAppointmentId: 'rdv',
    });
    await service.updateAssociations('card', 'salon', {
      sourceAppointmentId: 'rdv',
      replaceSourceCardId: 'previous-card',
    });
    expect(prisma.drawingCard.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'previous-card' },
      data: { tattooAppointmentId: null },
    });
    expect(prisma.drawingCard.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'card' },
        data: expect.objectContaining({ sourceAppointmentId: 'rdv' }),
      }),
    );
  });
  it('never replaces a card for a different client even when confirmation is supplied', async () => {
    prisma.drawingCard.findUniqueOrThrow.mockResolvedValue({
      ...card,
      clientId: 'client-b',
    });
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-b',
      linkedUserId: null,
    });
    await expect(
      service.updateAssociations('card', 'salon', {
        sourceAppointmentId: 'rdv',
        replaceSourceCardId: 'previous-card',
      }),
    ).rejects.toThrow('client de la card est différent');
    expect(prisma.drawingCard.update).not.toHaveBeenCalled();
  });
  it('refuses replacement when the artist cannot access the previous card', async () => {
    const artistCard = { ...card, performerUserId: 'artist' };
    prisma.drawingCard.findUnique.mockResolvedValue(artistCard);
    prisma.drawingCard.findUniqueOrThrow.mockResolvedValue(artistCard);
    prisma.appointment.findUnique.mockResolvedValue({
      ...appointment,
      performerUserId: 'artist',
    });
    prisma.drawingCard.findFirst.mockResolvedValue({
      id: 'previous-card',
      salonId: 'salon',
      performerUserId: 'other-artist',
      sourceAppointmentId: 'rdv',
    });
    await expect(
      service.updateAssociations('card', 'artist', {
        sourceAppointmentId: 'rdv',
        replaceSourceCardId: 'previous-card',
      }),
    ).rejects.toThrow('pas accès');
    expect(prisma.drawingCard.update).not.toHaveBeenCalled();
  });
  it('creates a standalone card without a client or appointment', async () => {
    await service.createCard('salon', { title: 'Dessin libre' });
    expect(prisma.drawingCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Dessin libre',
          salonId: 'salon',
          clientId: null,
          clientUserId: null,
          sourceAppointmentId: undefined,
        }),
      }),
    );
    expect(prisma.appointment.findUnique).not.toHaveBeenCalled();
  });
  it('requires a title for an independent card and rejects non-professionals', async () => {
    await expect(service.createCard('salon', {})).rejects.toThrow('titre');
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    await expect(
      service.createCard('client', { title: 'Dessin' }),
    ).rejects.toThrow('professionnels');
  });
  it('allows a client without a RDV and refuses clients from other salons', async () => {
    prisma.client.findFirst
      .mockResolvedValueOnce({ id: 'client-a', linkedUserId: 'account-a' })
      .mockResolvedValueOnce(null);
    await service.createCard('salon', {
      title: 'Dessin',
      clientId: 'client-a',
    });
    expect(prisma.drawingCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-a',
          clientUserId: 'account-a',
        }),
      }),
    );
    await expect(
      service.createCard('salon', {
        title: 'Dessin',
        clientId: 'foreign-client',
      }),
    ).rejects.toThrow('ne dépend pas');
  });
  it('adopts the chosen RDV client and refuses a conflicting selection', async () => {
    await service.createCard('salon', { sourceAppointmentId: 'rdv' });
    expect(prisma.drawingCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-a',
          sourceAppointmentId: 'rdv',
        }),
      }),
    );
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-b',
      linkedUserId: null,
    });
    await expect(
      service.createCard('salon', {
        clientId: 'client-b',
        sourceAppointmentId: 'rdv',
      }),
    ).rejects.toThrow('ne correspond pas');
  });
  it('rejects cross-client links with an understandable error before any write', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      ...card,
      clientId: 'client-b',
    });
    await expect(
      service.linkAppointment('card', 'rdv', 'salon'),
    ).rejects.toThrow('son client est différent');
    expect(prisma.drawingCard.updateMany).not.toHaveBeenCalled();
  });
  it('adopts a RDV client when linking an independent card', async () => {
    await service.linkAppointment('card', 'rdv', 'salon');
    expect(prisma.drawingCard.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-a',
          sourceAppointmentId: 'rdv',
        }),
      }),
    );
  });
  it('does not link inaccessible RDVs or another professional’s card', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...appointment,
      userId: 'other-salon',
    });
    await expect(
      service.linkAppointment('card', 'rdv', 'salon'),
    ).rejects.toThrow('Accès refusé');
    prisma.drawingCard.findUnique.mockResolvedValue({
      ...card,
      salonId: 'other-salon',
    });
    await expect(
      service.linkAppointment('card', 'rdv', 'salon'),
    ).rejects.toThrow('Accès refusé');
  });
  it('refuses a RDV that is already used by another card', async () => {
    prisma.drawingCard.findFirst.mockResolvedValue({ id: 'other-card' });
    await expect(
      service.linkAppointment('card', 'rdv', 'salon'),
    ).rejects.toThrow('déjà reliée');
    expect(prisma.drawingCard.updateMany).not.toHaveBeenCalled();
  });
  it('can remove both associations', async () => {
    await service.updateAssociations('card', 'salon', {
      clientId: null,
      clientUserId: null,
      sourceAppointmentId: null,
      tattooAppointmentId: null,
    });
    expect(prisma.drawingCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          clientId: null,
          clientUserId: null,
          sourceAppointmentId: null,
          tattooAppointmentId: null,
        },
      }),
    );
  });
  it('refuses to change the client while retaining a RDV for a different client', async () => {
    prisma.drawingCard.findUniqueOrThrow.mockResolvedValue({
      ...card,
      clientId: 'client-a',
      sourceAppointmentId: 'rdv',
    });
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-b',
      linkedUserId: null,
    });
    await expect(
      service.updateAssociations('card', 'salon', {
        clientId: 'client-b',
        clientUserId: null,
      }),
    ).rejects.toThrow('client de la card est différent');
    expect(prisma.drawingCard.update).not.toHaveBeenCalled();
  });
  it('can correct client and appointment together in one transaction', async () => {
    prisma.drawingCard.findUniqueOrThrow.mockResolvedValue({
      ...card,
      clientId: 'client-a',
      sourceAppointmentId: 'old-rdv',
    });
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-b',
      linkedUserId: null,
    });
    prisma.appointment.findUnique.mockResolvedValue({
      ...appointment,
      id: 'new-rdv',
      clientId: 'client-b',
    });
    await service.updateAssociations('card', 'salon', {
      clientId: 'client-b',
      clientUserId: null,
      sourceAppointmentId: 'new-rdv',
    });
    expect(prisma.drawingCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-b',
          sourceAppointmentId: 'new-rdv',
        }),
      }),
    );
  });
  it('recognizes a local client and their linked Inkera account as the same person', async () => {
    prisma.drawingCard.findUnique.mockResolvedValue({
      ...card,
      clientId: 'local-a',
      client: { linkedUserId: 'account-a' },
    });
    prisma.appointment.findUnique.mockResolvedValue({
      ...appointment,
      clientId: null,
      clientUserId: 'account-a',
    });
    await expect(
      service.linkAppointment('card', 'rdv', 'salon'),
    ).resolves.toBeDefined();
  });
  it('rejects stale edits instead of overwriting a concurrent modification', async () => {
    await expect(
      service.updateAssociations('card', 'salon', {
        expectedUpdatedAt: '2026-10-27T12:00:00Z',
      }),
    ).rejects.toThrow('a été modifiée');
    expect(prisma.drawingCard.update).not.toHaveBeenCalled();
  });
  it('clears delivery and approval flags when the actual client changes', async () => {
    prisma.drawingCard.findUniqueOrThrow.mockResolvedValue({
      ...card,
      clientId: 'client-a',
      status: 'APPROUVE',
    });
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-b',
      linkedUserId: null,
    });
    await service.updateAssociations('card', 'salon', {
      clientId: 'client-b',
      clientUserId: null,
    });
    expect(prisma.drawingCardImage.updateMany).toHaveBeenCalledWith({
      where: { cardId: 'card' },
      data: {
        clientEmailSentAt: null,
        clientMessageSentAt: null,
        isApproved: false,
      },
    });
    expect(prisma.drawingCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'TERMINE', approvedAt: null }),
      }),
    );
  });
  it('does not change the client while a version is being delivered', async () => {
    prisma.client.findFirst.mockResolvedValue({
      id: 'client-b',
      linkedUserId: null,
    });
    prisma.drawingCardImage.findFirst.mockResolvedValue({
      id: 'sending-version',
    });
    await expect(
      service.updateAssociations('card', 'salon', {
        clientId: 'client-b',
        clientUserId: null,
      }),
    ).rejects.toThrow('en cours d’envoi');
    expect(prisma.drawingCard.update).not.toHaveBeenCalled();
  });
});
