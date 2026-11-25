import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TatoueurHygieneService } from './tatoueur-hygiene.service';

describe('TatoueurHygieneService', () => {
  let prisma: any;
  let notifications: any;
  let files: any;
  let service: TatoueurHygieneService;

  beforeEach(() => {
    prisma = {
      tatoueur: {
        findUnique: jest.fn().mockResolvedValue({ id: 't1', userId: 'salon', name: 'Alex' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tatoueurHygieneDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING' }),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'd1' }),
      },
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    files = { deleteIfUnused: jest.fn().mockResolvedValue(undefined) };
    service = new TatoueurHygieneService(prisma, notifications, files);
  });

  it('lets only the owning salon submit a document, which goes back to pending', async () => {
    await service.submit('salon', 'user_salon', 't1', 'https://utfs.io/f/abc');
    const call = prisma.tatoueurHygieneDocument.upsert.mock.calls[0][0];
    expect(call.create).toEqual({ tatoueurId: 't1', salonId: 'salon', fileUrl: 'https://utfs.io/f/abc' });
    expect(call.update).toMatchObject({ status: 'PENDING', rejectionReason: null, reviewedAt: null });

    await expect(service.submit('other', 'user_salon', 't1', 'https://utfs.io/f/abc')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.submit('salon', 'client', 't1', 'https://utfs.io/f/abc')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submit('salon', 'user_tatoueur', 't1', 'https://utfs.io/f/abc')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submit('salon', 'user_salon', 't1', 'javascript:alert(1)')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes the replaced file when it is no longer used', async () => {
    prisma.tatoueurHygieneDocument.findUnique.mockResolvedValue({ fileUrl: 'https://utfs.io/f/old' });
    await service.submit('salon', 'user_salon', 't1', 'https://utfs.io/f/new');
    expect(files.deleteIfUnused).toHaveBeenCalledWith(['https://utfs.io/f/old']);
  });

  it('requires a reason to refuse and notifies the salon', async () => {
    prisma.tatoueurHygieneDocument.findUnique.mockResolvedValue({ id: 'd1', tatoueur: { id: 't1', name: 'Alex', userId: 'salon' } });
    await expect(service.adminReview('admin', 'd1', 'REJECTED', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await service.adminReview('admin', 'd1', 'REJECTED', 'Document illisible');
    expect(prisma.tatoueurHygieneDocument.update.mock.calls[0][0].data).toMatchObject({
      status: 'REJECTED', rejectionReason: 'Document illisible', reviewedBy: 'admin',
    });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'salon', type: 'team.hygiene_reviewed' }));
  });

  it('approves without a reason and resets to pending without notifying', async () => {
    prisma.tatoueurHygieneDocument.findUnique.mockResolvedValue({ id: 'd1', tatoueur: { id: 't1', name: 'Alex', userId: 'salon' } });
    await service.adminReview('admin', 'd1', 'APPROVED');
    expect(prisma.tatoueurHygieneDocument.update.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', rejectionReason: null });
    notifications.notify.mockClear();
    await service.adminReview('admin', 'd1', 'PENDING');
    expect(prisma.tatoueurHygieneDocument.update.mock.calls[1][0].data).toMatchObject({ status: 'PENDING', reviewedAt: null, reviewedBy: null });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lists pending documents by default for the admin', async () => {
    await service.adminList({});
    expect(prisma.tatoueurHygieneDocument.findMany.mock.calls[0][0].where).toEqual({ status: 'PENDING' });
    await service.adminList({ status: 'ALL' });
    expect(prisma.tatoueurHygieneDocument.findMany.mock.calls[1][0].where).toEqual({});
  });
});
