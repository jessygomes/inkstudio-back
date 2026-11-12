import { ActivityService, ACTIVITY_LIMIT, ACTIVITY_MAX_DAYS } from './activity.service';

function build(plan: 'FREE' | 'PRO' = 'PRO') {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ saasPlan: plan }) },
    followUpSubmission: { findMany: jest.fn().mockResolvedValue([{ id: 'f1', createdAt: new Date() }]) },
    salonReview: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', createdAt: new Date() }]) },
  };
  const appointments = { findRecentClientBookings: jest.fn().mockResolvedValue([{ id: 'a1', createdAt: new Date() }]) };
  return { service: new ActivityService(prisma as never, appointments as never), prisma, appointments };
}

describe('ActivityService.recent', () => {
  it('renvoie rendez-vous, suivis et avis récents (id et date seulement)', async () => {
    const { service, prisma, appointments } = build();
    const since = Date.now() - 3 * 86_400_000;
    const res = await service.recent('salon-1', since);
    expect(res.appointments.map((a) => a.id)).toEqual(['a1']);
    expect(res.followUps.map((a) => a.id)).toEqual(['f1']);
    expect(res.reviews.map((a) => a.id)).toEqual(['r1']);
    expect(appointments.findRecentClientBookings).toHaveBeenCalledWith('salon-1', new Date(since), ACTIVITY_LIMIT);
    expect(prisma.followUpSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'salon-1', createdAt: { gte: new Date(since) } }, select: { id: true, createdAt: true } }));
    expect(prisma.salonReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: 'salon-1', isVisible: true, createdAt: { gte: new Date(since) } }, select: { id: true, createdAt: true } }));
  });

  it(`limite la fenêtre à ${ACTIVITY_MAX_DAYS} jours, même avec une date plus ancienne ou absente`, async () => {
    const { service, appointments } = build();
    const before = Date.now() - ACTIVITY_MAX_DAYS * 86_400_000;
    await service.recent('salon-1', Date.now() - 400 * 86_400_000);
    await service.recent('salon-1');
    for (const call of appointments.findRecentClientBookings.mock.calls) {
      const since = (call[1] as Date).getTime();
      expect(since).toBeGreaterThanOrEqual(before);
      expect(since).toBeLessThan(before + 60_000);
    }
  });

  it('plan gratuit : uniquement les avis', async () => {
    const { service, prisma, appointments } = build('FREE');
    const res = await service.recent('salon-1', Date.now());
    expect(res.appointments).toEqual([]);
    expect(res.followUps).toEqual([]);
    expect(res.reviews).toHaveLength(1);
    expect(appointments.findRecentClientBookings).not.toHaveBeenCalled();
    expect(prisma.followUpSubmission.findMany).not.toHaveBeenCalled();
  });
});
