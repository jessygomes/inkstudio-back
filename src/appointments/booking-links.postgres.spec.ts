/* Real PostgreSQL suite. Run with scripts/test-booking-links-postgres.cjs. */
import { PrismaClient, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BookingLinksService } from './booking-links.service';
import { ResidenciesService } from '../residencies/residencies.service';
import { InboxService } from '../messaging/inbox/inbox.service';
import { CreateBookingLinkDto } from './dto/booking-link.dto';
import { SkinTone } from './constants/skin-tone.constants';
import { AppointmentsService } from './appointments.service';

const databaseUrl = process.env.BOOKING_LINK_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('Booking links with real PostgreSQL transactions', () => {
  let db: PrismaClient;
  let service: BookingLinksService;
  let residencies: ResidenciesService;
  let salon: string, artist: string, account: string, client: string;
  const effects = { afterConfirmation: jest.fn().mockResolvedValue(undefined) };
  const cache = { delPattern: jest.fn().mockResolvedValue(undefined) };
  const hours = JSON.stringify(
    Object.fromEntries(
      [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ].map((d) => [d, { start: '09:00', end: '18:00' }]),
    ),
  );
  const day = '2030-01-07';
  const request = {
    start: `${day}T09:00:00.000Z`,
    rdvBody: {
      clientFirstname: 'Alice',
      clientLastname: 'Test',
      clientEmail: 'unused@example.test',
      skin: SkinTone.MATE,
    },
  };
  const input = (
    extra: Partial<CreateBookingLinkDto> = {},
  ): CreateBookingLinkDto => ({
    tatoueurId: artist,
    prestation: 'TATTOO',
    durationMinutes: 180,
    mode: 'FIXED_START',
    fixedStartTime: '10:00',
    allowedFrom: day,
    allowedTo: day,
    ...extra,
  });
  const token = (result: { bookingUrl: string }) =>
    result.bookingUrl.split('/').at(-1)!;
  const create = (extra: Partial<CreateBookingLinkDto> = {}, actor = salon) =>
    service.create(actor, input(extra));
  const user = async (role: Role = 'user_salon') => {
    const id = randomUUID();
    await db.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        emailVerified: new Date(),
        password: 'test-only',
        role,
        saasPlan: 'PRO',
        salonName: 'Black Ink Tattoo',
        salonHours: hours,
        city: 'Paris',
        postalCode: '75001',
        prestations: ['TATTOO', 'RETOUCHE', 'PROJET'],
        salonPhotos: [],
        style: [],
      },
    });
    return id;
  };
  const sourceProject = () =>
    db.appointment.create({
      data: {
        userId: salon,
        tatoueurId: artist,
        clientId: client,
        clientUserId: account,
        prestation: 'PROJET',
        title: 'Projet',
        start: new Date('2029-01-01T09:00:00Z'),
        end: new Date('2029-01-01T10:00:00Z'),
        status: 'COMPLETED',
      },
    });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/inkera_booking_test'
    )
      throw new Error(
        'Only the isolated local booking test database is allowed',
      );
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    residencies = new ResidenciesService(db as any, cache as any);
    service = new BookingLinksService(
      db as any,
      residencies,
      new InboxService(db as any, {} as any),
      { enforceSaasAccess: jest.fn() } as any,
      effects as any,
    );
  });
  beforeEach(async () => {
    effects.afterConfirmation.mockClear();
    salon = await user();
    account = await user('client');
    artist = (
      await db.tatoueur.create({
        data: { userId: salon, name: 'Artist', hours, skills: [], style: [] },
      })
    ).id;
    client = (
      await db.client.create({
        data: {
          userId: salon,
          linkedUserId: account,
          email: `${account}@example.test`,
          firstName: 'Alice',
          lastName: 'Test',
          phone: '',
          tags: [],
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('creates a standalone secure invitation without an appointment and resolves renamed public slugs', async () => {
    const result = await create();
    expect(result.bookingUrl).toMatch(
      /^https:\/\/theinkera.com\/black-ink-tattoo\/rdv\/[\w-]{43}$/,
    );
    const stored = await db.bookingLink.findUniqueOrThrow({
      where: { id: result.link.id },
    });
    expect(stored.tokenHash).toHaveLength(64);
    expect(JSON.stringify(result)).not.toContain(stored.tokenHash);
    expect(await db.appointment.count({ where: { userId: salon } })).toBe(0);
    await db.user.update({
      where: { id: salon },
      data: { salonName: 'Nouveau Salon' },
    });
    const info = await service.publicInfo(token(result));
    expect(info.bookingUrl).toContain('/nouveau-salon/rdv/');
    expect(info).not.toHaveProperty('clientId');
    expect(info).not.toHaveProperty('userId');
    expect(JSON.stringify(info)).not.toContain('@example.test');
  });
  it.each(['TATTOO', 'RETOUCHE'] as const)(
    'confirms a %s with the existing CRM identity and notifications',
    async (prestation) => {
      const link = await create({ prestation, clientId: client });
      const result = await service.confirm(token(link), request, account);
      const rdv = await db.appointment.findUniqueOrThrow({
        where: { id: result.appointment.id },
        include: { tattooDetail: true },
      });
      expect(rdv).toMatchObject({
        prestation,
        status: 'CONFIRMED',
        clientId: client,
        clientUserId: account,
      });
      expect(rdv.end.getTime() - rdv.start.getTime()).toBe(180 * 60000);
      expect(rdv.tattooDetail).not.toBeNull();
      expect(await db.client.count({ where: { userId: salon } })).toBe(1);
      expect(effects.afterConfirmation).toHaveBeenCalledTimes(1);
      await expect(
        service.confirm(token(link), request, account),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BOOKING_LINK_USED' }),
      });
      expect(effects.afterConfirmation).toHaveBeenCalledTimes(1);
    },
  );
  it('retains project, CRM and Inkera conversation associations atomically', async () => {
    const project = await sourceProject();
    const conversation = await db.conversation.create({
      data: {
        salonId: salon,
        clientUserId: account,
        appointmentId: project.id,
      },
    });
    const link = await create({
      projectAppointmentId: project.id,
      tatoueurId: undefined,
    });
    expect(link.link).toMatchObject({
      projectAppointmentId: project.id,
      clientId: client,
      clientUserId: account,
      conversationId: conversation.id,
    });
    const result = await service.confirm(token(link), request, account);
    expect(
      await db.inboxThreadAppointment.count({
        where: {
          inboxThreadId: link.link.inboxThreadId!,
          appointmentId: result.appointment.id,
        },
      }),
    ).toBe(1);
    expect(
      (
        await db.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        })
      ).appointmentId,
    ).toBe(project.id);
    expect(
      (await db.bookingLink.findUniqueOrThrow({ where: { id: link.link.id } }))
        .appointmentId,
    ).toBe(result.appointment.id);
  });
  it('creates from a conversation with a reliable account association', async () => {
    const conversation = await db.conversation.create({
      data: { salonId: salon, clientUserId: account },
    });
    const link = await create({ conversationId: conversation.id });
    expect(link.link.clientUserId).toBe(account);
    expect(link.link.clientId).toBe(client);
    await expect(service.confirm(token(link), request)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.confirm(token(link), request, await user('client')),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('keeps an unlinked external contact as provenance without arbitrary CRM linking', async () => {
    const connection = await db.channelConnection.create({
      data: {
        ownerUserId: salon,
        provider: 'INSTAGRAM',
        status: 'ACTIVE',
        providerAccountId: randomUUID(),
      },
    });
    const contact = await db.externalContact.create({
      data: {
        connectionId: connection.id,
        providerContactId: randomUUID(),
        displayName: 'Alice',
        email: `${account}@example.test`,
      },
    });
    const external = await db.externalConversation.create({
      data: {
        connectionId: connection.id,
        contactId: contact.id,
        providerThreadId: randomUUID(),
      },
    });
    const thread = await db.inboxThread.create({
      data: {
        ownerUserId: salon,
        channel: 'INSTAGRAM',
        externalConversationId: external.id,
      },
    });
    const link = await create({ inboxThreadId: thread.id });
    expect(link.link.clientId).toBeNull();
    expect(link.link.clientUserId).toBeNull();
    const result = await service.confirm(token(link), {
      ...request,
      rdvBody: {
        ...request.rdvBody,
        clientEmail: `${randomUUID()}@example.test`,
      },
    });
    expect(
      await db.inboxThreadAppointment.count({
        where: { appointmentId: result.appointment.id },
      }),
    ).toBe(0);
    expect(
      (await db.inboxThread.findUniqueOrThrow({ where: { id: thread.id } }))
        .linkedClientId,
    ).toBeNull();
  });
  it('supports independent artists and exact custom automatic durations', async () => {
    const independent = await user('user_tatoueur');
    const link = await service.create(
      independent,
      input({
        tatoueurId: `linked_${independent}`,
        durationMinutes: 95,
        mode: 'AUTOMATIC',
        fixedStartTime: undefined,
      }),
    );
    const available = await service.availability(token(link), {
      from: day,
      to: day,
    });
    const slot = available.dates[0].slots[0];
    expect(slot.end.getTime() - slot.start.getTime()).toBe(95 * 60000);
    const result = await service.confirm(
      token(link),
      { ...request, start: slot.start.toISOString() },
      account,
    );
    expect(
      (
        await db.appointment.findUniqueOrThrow({
          where: { id: result.appointment.id },
        })
      ).performerUserId,
    ).toBe(independent);
  });
  it('enforces residency create, public booking and management permissions', async () => {
    const performer = await user('user_tatoueur');
    const membership = await db.salonResidency.create({
      data: {
        salonId: salon,
        artistId: performer,
        presence: { type: 'daily' },
        artistAllowsPublicBooking: true,
        salonAllowsPublicBooking: true,
      },
    });
    const options = { tatoueurId: `linked_${performer}`, venueSalonId: salon };
    await expect(create(options)).rejects.toMatchObject({ status: 403 });
    await db.salonResidency.update({
      where: { id: membership.id },
      data: { artistAllowsSalonCreate: true },
    });
    const link = await create(options);
    await expect(service.revoke(salon, link.link.id)).rejects.toMatchObject({
      status: 403,
    });
    await db.salonResidency.update({
      where: { id: membership.id },
      data: { artistAllowsSalonManage: true },
    });
    await expect(service.revoke(salon, link.link.id)).resolves.toHaveProperty(
      'link.status',
      'REVOKED',
    );
    const second = await create(options);
    await db.salonResidency.update({
      where: { id: membership.id },
      data: { artistAllowsPublicBooking: false },
    });
    await expect(
      service.confirm(token(second), request, account),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('denies foreign salon resources and non-professional accounts', async () => {
    const foreign = await user();
    await expect(
      service.create(foreign, input({ userId: salon })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.create(account, input({ userId: salon })),
    ).rejects.toMatchObject({ status: 403 });
    const link = await create();
    await expect(service.get(foreign, link.link.id)).rejects.toMatchObject({
      status: 403,
    });
    expect((await service.list(foreign, { page: 1, limit: 20 })).data).toEqual(
      [],
    );
    await expect(service.revoke(foreign, link.link.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('filters full durations against pauses and only blocking appointment statuses', async () => {
    const link = await create({ mode: 'AUTOMATIC', fixedStartTime: undefined });
    await db.blockedTimeSlot.create({
      data: {
        userId: salon,
        tatoueurId: artist,
        startDate: new Date(`${day}T11:00:00Z`),
        endDate: new Date(`${day}T12:00:00Z`),
      },
    });
    const busy = await db.appointment.create({
      data: {
        userId: salon,
        tatoueurId: artist,
        prestation: 'PROJET',
        title: 'Busy',
        start: new Date(`${day}T14:00:00Z`),
        end: new Date(`${day}T15:00:00Z`),
        status: 'PENDING',
      },
    });
    expect(
      (await service.availability(token(link), { from: day, to: day })).dates[0]
        .slots,
    ).toEqual([
      {
        start: new Date(`${day}T08:00:00Z`),
        end: new Date(`${day}T11:00:00Z`),
      },
    ]);
    await db.appointment.update({
      where: { id: busy.id },
      data: { status: 'CANCELED' },
    });
    expect(
      (
        await service.availability(token(link), { from: day, to: day })
      ).dates[0].slots.some(
        (s) => s.start.getTime() === new Date(`${day}T12:00:00Z`).getTime(),
      ),
    ).toBe(true);
  });
  it('rechecks availability after a client has loaded the link', async () => {
    const link = await create();
    expect(
      (await service.availability(token(link), { from: day, to: day })).dates,
    ).toHaveLength(1);
    await db.blockedTimeSlot.create({
      data: {
        userId: salon,
        startDate: new Date(`${day}T10:00:00Z`),
        endDate: new Date(`${day}T10:30:00Z`),
      },
    });
    await expect(
      service.confirm(token(link), request, account),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SLOT_UNAVAILABLE' }),
    });
    expect(
      (await db.bookingLink.findUniqueOrThrow({ where: { id: link.link.id } }))
        .status,
    ).toBe('ACTIVE');
    expect(await db.appointment.count({ where: { userId: salon } })).toBe(0);
    expect(effects.afterConfirmation).not.toHaveBeenCalled();
  });
  it.each(['same', 'different'] as const)(
    'serializes simultaneous confirmations using %s links',
    async (kind) => {
      const first = await create(),
        second = kind === 'same' ? first : await create();
      const results = await Promise.allSettled([
        service.confirm(token(first), request, account),
        service.confirm(token(second), request, account),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.appointment.count({ where: { userId: salon } })).toBe(1);
      expect(
        await db.bookingLink.count({
          where: { userId: salon, status: 'USED' },
        }),
      ).toBe(1);
      expect(effects.afterConfirmation).toHaveBeenCalledTimes(1);
    },
  );
  it('shares calendar locks with ordinary appointment writes', async () => {
    const link = await create();
    const results = await Promise.allSettled([
      service.confirm(token(link), request, account),
      residencies.persistAppointment(
        {
          data: {
            userId: salon,
            tatoueurId: artist,
            title: 'Ordinary',
            prestation: 'TATTOO',
            start: new Date(request.start),
            end: new Date(`${day}T12:00:00Z`),
            status: 'CONFIRMED',
          },
        },
        salon,
        false,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.appointment.count({ where: { userId: salon } })).toBe(1);
  });
  it('rolls back the appointment and consumption if an association changed', async () => {
    const conversation = await db.conversation.create({
      data: { salonId: salon, clientUserId: account },
    });
    const link = await create({ conversationId: conversation.id });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { clientUserId: await user('client') },
    });
    await expect(
      service.confirm(token(link), request, account),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ASSOCIATION_CHANGED' }),
    });
    expect(await db.appointment.count({ where: { userId: salon } })).toBe(0);
    expect(
      (await db.bookingLink.findUniqueOrThrow({ where: { id: link.link.id } }))
        .status,
    ).toBe('ACTIVE');
    expect(effects.afterConfirmation).not.toHaveBeenCalled();
  });
  it('returns explicit expiration, revocation and invalid-token errors', async () => {
    const expired = await create(),
      revoked = await create();
    await db.bookingLink.update({
      where: { id: expired.link.id },
      data: { expiresAt: new Date('2020-01-01') },
    });
    await expect(service.publicInfo(token(expired))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BOOKING_LINK_EXPIRED' }),
    });
    await service.revoke(salon, revoked.link.id);
    await expect(
      service.confirm(token(revoked), request, account),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BOOKING_LINK_REVOKED' }),
    });
    await expect(service.publicInfo('invalid')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('does not claim an existing CRM record by a caller-supplied email', async () => {
    const link = await create();
    await expect(
      service.confirm(token(link), {
        ...request,
        rdvBody: { ...request.rdvBody, clientEmail: `${account}@example.test` },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLIENT_LINK_REQUIRED' }),
    });
    expect(
      (await db.client.findUniqueOrThrow({ where: { id: client } }))
        .linkedUserId,
    ).toBe(account);
  });
  it('requires a verified account for a targeted unlinked CRM record and does not change its manual linkage', async () => {
    await db.client.update({
      where: { id: client },
      data: { linkedUserId: null },
    });
    const link = await create({ clientId: client });
    await db.user.update({
      where: { id: account },
      data: { emailVerified: null },
    });
    await expect(
      service.confirm(token(link), request, account),
    ).rejects.toMatchObject({ status: 403 });
    await db.user.update({
      where: { id: account },
      data: { emailVerified: new Date() },
    });
    await service.confirm(token(link), request, account);
    expect(
      (await db.client.findUniqueOrThrow({ where: { id: client } }))
        .linkedUserId,
    ).toBeNull();
  });
  it('persists and clears project preferences without changing calendar times or creating tattoos', async () => {
    const project = await sourceProject();
    const appointments = new AppointmentsService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      {} as any,
      residencies,
    );
    await appointments.updateDesiredTattooPeriod(project.id, salon, {
      desiredTattooPeriod: 'DATE_RANGE',
      desiredTattooStartDate: '2030-03-01',
      desiredTattooEndDate: '2030-04-01',
    });
    const updated = await db.appointment.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(updated.desiredTattooPeriod).toBe('DATE_RANGE');
    expect(updated.start).toEqual(project.start);
    expect(updated.end).toEqual(project.end);
    expect(await db.appointment.count({ where: { userId: salon } })).toBe(1);
    await expect(
      appointments.updateDesiredTattooPeriod(project.id, account, {
        desiredTattooPeriod: 'ASAP',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await appointments.updateDesiredTattooPeriod(project.id, salon, {
      desiredTattooPeriod: null,
    });
    expect(
      (await db.appointment.findUniqueOrThrow({ where: { id: project.id } }))
        .desiredTattooStartDate,
    ).toBeNull();
  });
});
