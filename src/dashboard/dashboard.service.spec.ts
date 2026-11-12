import { ForbiddenException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

function build(overrides: { saas?: () => Promise<void> } = {}) {
  const appointments = {
    getTodaysAppointments: jest.fn().mockResolvedValue([{ id: 'a1' }]),
    getPendingAppointments: jest.fn().mockResolvedValue({ appointments: [] }),
    getWeeklyFillRate: jest.fn().mockResolvedValue({ rate: 42 }),
    getGlobalCancellationRate: jest.fn().mockResolvedValue({ rate: 5 }),
    getTotalPaidAppointmentsByMonth: jest.fn().mockResolvedValue({ total: 100 }),
  };
  const clients = { getNewClientsCountByMonth: jest.fn().mockResolvedValue({ count: 3 }) };
  const conversations = { getConversationsWithUnreadMessages: jest.fn().mockResolvedValue([]) };
  const reviews = { getRecentReviewsBySalon: jest.fn().mockResolvedValue([]) };
  const drawing = { getCards: jest.fn().mockResolvedValue([]) };
  const saas = { enforceSaasAccess: jest.fn(overrides.saas ?? (() => Promise.resolve())) };
  const prisma = { followUpSubmission: { findMany: jest.fn().mockResolvedValue([{ id: 'f1' }]) } };
  const service = new DashboardService(prisma as never, appointments as never, clients as never, conversations as never, reviews as never, drawing as never, saas as never);
  return { service, appointments, clients, conversations, reviews, drawing, saas, prisma };
}

describe('DashboardService.summary', () => {
  it('renvoie tous les blocs en une réponse', async () => {
    const { service } = build();
    const res = await service.summary('salon-1', { date: '2026-11-12', month: 11, year: 2026 });
    expect(Object.keys(res).sort()).toEqual(
      ['cancelRate', 'conversations', 'drawingCards', 'fillRate', 'followUps', 'newClients', 'paid', 'pending', 'recentReviews', 'today'].sort(),
    );
    expect(res.today).toEqual({ ok: true, data: [{ id: 'a1' }] });
    expect(res.followUps).toEqual({ ok: true, data: { followUps: [{ id: 'f1' }] } });
  });

  it('transmet les paramètres aux services', async () => {
    const { service, appointments, clients } = build();
    await service.summary('salon-1', { date: '2026-11-12', fillStart: '2026-11-08T23:00:00.000Z', fillEnd: '2026-11-15T22:59:59.999Z', month: 11, year: 2026 });
    expect(appointments.getTodaysAppointments).toHaveBeenCalledWith('salon-1', '2026-11-12');
    expect(appointments.getWeeklyFillRate).toHaveBeenCalledWith('salon-1', '2026-11-08T23:00:00.000Z', '2026-11-15T22:59:59.999Z');
    expect(clients.getNewClientsCountByMonth).toHaveBeenCalledWith('salon-1', 11, 2026);
    expect(appointments.getTotalPaidAppointmentsByMonth).toHaveBeenCalledWith('salon-1', 11, 2026);
  });

  it("une erreur dans un bloc n'empêche pas les autres", async () => {
    const { service, conversations } = build();
    conversations.getConversationsWithUnreadMessages.mockRejectedValue(new Error('boom'));
    const res = await service.summary('salon-1');
    expect(res.conversations).toEqual({ ok: false, status: 500, message: 'boom' });
    expect(res.today?.ok).toBe(true);
    expect(res.pending?.ok).toBe(true);
  });

  it('plan gratuit : les blocs statistiques sont refusés, les autres restent disponibles', async () => {
    const { service, appointments } = build({ saas: () => Promise.reject(new ForbiddenException('Le plan FREE ne permet pas de …')) });
    const res = await service.summary('salon-1');
    for (const name of ['today', 'fillRate', 'cancelRate', 'newClients', 'paid'] as const) {
      expect(res[name]).toEqual({ ok: false, status: 403, message: 'Le plan FREE ne permet pas de …' });
    }
    expect(appointments.getTodaysAppointments).not.toHaveBeenCalled();
    expect(res.pending?.ok).toBe(true);
    expect(res.followUps?.ok).toBe(true);
    expect(res.recentReviews?.ok).toBe(true);
  });

  it('ne vérifie le plan qu\'une fois, et pas du tout si aucun bloc statistique n\'est demandé', async () => {
    const a = build();
    await a.service.summary('salon-1');
    expect(a.saas.enforceSaasAccess).toHaveBeenCalledTimes(1);

    const b = build();
    const res = await b.service.summary('salon-1', {}, ['pending', 'recentReviews']);
    expect(b.saas.enforceSaasAccess).not.toHaveBeenCalled();
    expect(Object.keys(res).sort()).toEqual(['pending', 'recentReviews']);
    expect(b.appointments.getTodaysAppointments).not.toHaveBeenCalled();
  });

  it('lance les requêtes en parallèle', async () => {
    const { service, appointments, conversations } = build();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    appointments.getPendingAppointments.mockImplementation(async () => { await gate; return []; });
    conversations.getConversationsWithUnreadMessages.mockImplementation(async () => { await gate; return []; });
    const pending = service.summary('salon-1', {}, ['pending', 'conversations']);
    await new Promise((r) => setImmediate(r));
    // Les deux sont déjà démarrées alors qu'aucune n'a fini.
    expect(appointments.getPendingAppointments).toHaveBeenCalled();
    expect(conversations.getConversationsWithUnreadMessages).toHaveBeenCalled();
    release();
    await pending;
  });
});
