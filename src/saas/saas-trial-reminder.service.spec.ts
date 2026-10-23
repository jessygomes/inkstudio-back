import { SaasTrialReminderService } from './saas-trial-reminder.service';
import { DAY_MS, nativeTrialEndDate, reminderMilestones } from './trial-policy';

const now = new Date('2026-10-23T10:00:00Z');
const end = new Date(now.getTime() + 2.5 * DAY_MS);
const data = { userId: 'u1', trialEndDate: end.toISOString(), daysBeforeEnd: 3 };
const trial = () => ({
  userId: 'u1', currentPlan: 'BUSINESS', planStatus: 'TRIAL', trialEndDate: end,
  user: { role: 'user_salon', email: 'salon@example.com', firstName: 'Alex', salonName: 'Salon', stripeSubscriptionId: null },
});

describe('Native trial policy', () => {
  it('offers 60 days only to Business salons', () => {
    expect(nativeTrialEndDate('user_salon', 'BUSINESS', now)?.getTime()).toBe(now.getTime() + 60 * DAY_MS);
    expect(nativeTrialEndDate('user_tatoueur', 'BUSINESS', now)).toBeNull();
    expect(nativeTrialEndDate('user_salon', 'FREE', now)).toBeNull();
  });
  it('clamps three calendar months at the end of a month', () => {
    expect(nativeTrialEndDate('user_tatoueur', 'PRO', new Date('2026-01-31T10:00:00Z'))?.toISOString()).toBe('2026-04-30T10:00:00.000Z');
  });
  it('catches up only the latest due reminder after downtime', () => {
    expect(reminderMilestones(end, now).map(x => x.daysBeforeEnd)).toEqual([3, 1]);
    expect(reminderMilestones(end, now)[0].delay).toBe(0);
    expect(reminderMilestones(new Date(now.getTime() + 0.5 * DAY_MS), now).map(x => x.daysBeforeEnd)).toEqual([1]);
    expect(reminderMilestones(now, now)).toEqual([]);
  });
});

describe('SaasTrialReminderService', () => {
  const prisma = { saasPlanDetails: { findMany: jest.fn(), findUnique: jest.fn() } };
  const mail = { sendTrialEndingSoonReminder: jest.fn() };
  const queue = { add: jest.fn() };
  const service = new SaasTrialReminderService(prisma as never, mail as never, queue as never);
  beforeEach(() => { jest.clearAllMocks(); prisma.saasPlanDetails.findUnique.mockResolvedValue(trial()); });

  it('uses durable stable job IDs for repeat scans', async () => {
    prisma.saasPlanDetails.findMany.mockResolvedValue([{ userId: 'u1', trialEndDate: end }]);
    await service.schedule(now);
    await service.schedule(now);
    expect(queue.add).toHaveBeenCalledTimes(4);
    expect(queue.add.mock.calls[0][2].jobId).toBe(queue.add.mock.calls[2][2].jobId);
    expect(queue.add.mock.calls[0][2]).toEqual(expect.objectContaining({ removeOnComplete: false, attempts: 3 }));
    expect(prisma.saasPlanDetails.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user: expect.objectContaining({ stripeSubscriptionId: null }) }),
    }));
  });
  it('sends the native reminder with the plan and date', async () => {
    await expect(service.send(data, now)).resolves.toEqual({ sent: true });
    expect(mail.sendTrialEndingSoonReminder).toHaveBeenCalledWith('salon@example.com', expect.objectContaining({ planName: 'Business', salonName: 'Inkera Studio' }));
  });
  it.each(['subscribed', 'active', 'rescheduled', 'expired', 'wrong-role'])('skips a %s reminder', async reason => {
    const entry = trial();
    if (reason === 'subscribed') (entry.user as { stripeSubscriptionId: string | null }).stripeSubscriptionId = 'sub_paid';
    if (reason === 'active') entry.planStatus = 'ACTIVE';
    if (reason === 'rescheduled') entry.trialEndDate = new Date(end.getTime() + DAY_MS);
    if (reason === 'expired') entry.trialEndDate = new Date(now.getTime() - 1);
    if (reason === 'wrong-role') entry.user.role = 'user_tatoueur';
    prisma.saasPlanDetails.findUnique.mockResolvedValue(entry);
    await expect(service.send(data, now)).resolves.toEqual({ skipped: true });
    expect(mail.sendTrialEndingSoonReminder).not.toHaveBeenCalled();
  });
  it('skips a delayed old J-7 retry and an early J-1 reminder', async () => {
    await expect(service.send({ ...data, daysBeforeEnd: 7 }, now)).resolves.toEqual({ skipped: true });
    await expect(service.send({ ...data, daysBeforeEnd: 1 }, now)).resolves.toEqual({ skipped: true });
    expect(mail.sendTrialEndingSoonReminder).not.toHaveBeenCalled();
  });
  it('propagates mail failures so Bull can retry', async () => {
    mail.sendTrialEndingSoonReminder.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.send(data, now)).rejects.toThrow('provider unavailable');
  });
});
