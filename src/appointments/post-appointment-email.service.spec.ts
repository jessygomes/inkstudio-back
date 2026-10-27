import { PostAppointmentEmailService } from './post-appointment-email.service';

describe('Post appointment reminder reconciliation', () => {
  it('uses professional delays and retries each kind independently through shared delivery', async () => {
    const prisma = { $queryRaw: jest.fn(async () => [{ id: 'a' }, { id: 'b' }]) } as any;
    const delivery = { deliver: jest.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(true) } as any;
    const result = await new PostAppointmentEmailService(prisma, delivery).sendDueEmails();
    expect(delivery.deliver.mock.calls).toEqual([['a', 'FOLLOW_UP'], ['a', 'RETOUCH'], ['b', 'FOLLOW_UP'], ['b', 'RETOUCH']]);
    expect(result).toEqual({ sent7Days: 1, sent30Days: 2 });
    const sql = prisma.$queryRaw.mock.calls[0][0].join('');
    expect(sql).toContain('u."followUpEmailDelayDays"');
    expect(sql).toContain('u."retouchEmailDelayDays"');
    expect(sql).toContain('COALESCE(a."performerUserId", a."userId")');
  });
});
