import { ProjectProposalEmailService } from './project-proposal-email.service';
import { renderProjectProposalEmail } from '../email/project-proposal-email';

describe('Proposal email delivery', () => {
  let prisma: any;
  let mail: any;
  let queue: any;
  let service: ProjectProposalEmailService;
  const now = new Date('2026-10-25T12:00:00Z');
  beforeEach(() => {
    prisma = {
      projectProposalEmail: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'email', moodboardId: 'board', threshold: 1, attempts: 0 },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      moodboard: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            name: 'Projet floral',
            clientProfile: { user: { email: 'client@example.test' } },
          }),
      },
    };
    mail = { sendMail: jest.fn().mockResolvedValue({ id: 'mail' }) };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
    service = new ProjectProposalEmailService(prisma, mail, queue);
  });

  it('sends to the owning client and records successful delivery', async () => {
    await expect(service.dispatch(now)).resolves.toEqual({ sent: 1 });
    expect(mail.sendMail).toHaveBeenCalledWith(
      'client@example.test',
      expect.stringContaining('une proposition'),
      expect.stringContaining('Projet floral'),
      'Inkera People',
    );
    expect(prisma.projectProposalEmail.update).toHaveBeenCalledWith({
      where: { id: 'email' },
      data: expect.objectContaining({ status: 'SENT' }),
    });
  });

  it('does not deliver a row claimed by a concurrent worker', async () => {
    prisma.projectProposalEmail.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.dispatch(now)).resolves.toEqual({ sent: 0 });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('retries a delivery failure with backoff', async () => {
    mail.sendMail.mockRejectedValue(new Error('Unavailable'));
    await expect(service.dispatch(now)).resolves.toEqual({ sent: 0 });
    expect(prisma.projectProposalEmail.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          nextAttemptAt: new Date(now.getTime() + 120_000),
        }),
      }),
    );
    expect(prisma.projectProposalEmail.update).not.toHaveBeenCalled();
  });

  it('stops retrying after five failed attempts', async () => {
    prisma.projectProposalEmail.findMany.mockResolvedValue([
      { id: 'email', moodboardId: 'board', threshold: 5, attempts: 4 },
    ]);
    mail.sendMail.mockRejectedValue(new Error('Unavailable'));
    await service.dispatch(now);
    expect(prisma.projectProposalEmail.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('keeps the outbox intact if Redis is down and schedules periodic recovery', async () => {
    queue.add.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service.requestDelivery()).resolves.toBeUndefined();
    expect(prisma.projectProposalEmail.update).not.toHaveBeenCalled();
    queue.add.mockResolvedValue({});
    await service.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(
      'send-pending',
      {},
      expect.objectContaining({ repeat: { every: 60_000 } }),
    );
  });

  it.each<[number, string]>([
    [1, 'une proposition'],
    [5, '5 propositions'],
    [11, 'plus de 10 propositions'],
  ])(
    'renders the correct milestone %i and escapes user content',
    (threshold: number, text: string) => {
      const result = renderProjectProposalEmail(
        '<script>projet</script>',
        threshold,
      );
      expect(result.subject).toContain(text);
      expect(result.html).toContain('&lt;script&gt;projet&lt;/script&gt;');
      expect(result.html).not.toContain('<script>projet</script>');
      expect(result.html).toContain('/mon-profil?tab=messagerie');
    },
  );
});
