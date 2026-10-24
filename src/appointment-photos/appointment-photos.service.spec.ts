import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppointmentPhotosService } from './appointment-photos.service';
import { PrismaService } from 'src/database/prisma.service';

describe('AppointmentPhotosService', () => {
  const prisma = {
    appointment: { findUnique: jest.fn() },
    client: { findFirst: jest.fn() },
    appointmentPhoto: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((operations) => Promise.all(operations)),
  };
  const service = new AppointmentPhotosService(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.appointment.findUnique.mockResolvedValue({ id: 'rdv', userId: 'salon', performerUserId: 'artist' });
  });

  it('rejects another salon before accessing photos', async () => {
    await expect(service.list('rdv', 'stranger')).rejects.toThrow(ForbiddenException);
    await expect(service.add('rdv', 'stranger', { photos: [{ url: 'https://example.com/a.jpg' }] })).rejects.toThrow(ForbiddenException);
    await expect(service.remove('rdv', 'photo', 'stranger')).rejects.toThrow(ForbiddenException);
    expect(prisma.appointmentPhoto.findMany).not.toHaveBeenCalled();
    expect(prisma.appointmentPhoto.create).not.toHaveBeenCalled();
    expect(prisma.appointmentPhoto.deleteMany).not.toHaveBeenCalled();
  });

  it('accepts several photos for the assigned artist in one transaction', async () => {
    prisma.appointmentPhoto.create.mockImplementation(({ data }) => Promise.resolve(data));
    const photos = [{ url: 'https://example.com/a.jpg' }, { url: 'https://example.com/b.jpg', caption: 'Après séance' }];
    const result = await service.add('rdv', 'artist', { photos });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ appointmentId: 'rdv', ...photos[1] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('never deletes a photo belonging to a different appointment', async () => {
    prisma.appointmentPhoto.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('rdv', 'foreign-photo', 'salon')).rejects.toThrow(NotFoundException);
    expect(prisma.appointmentPhoto.deleteMany).toHaveBeenCalledWith({ where: { id: 'foreign-photo', appointmentId: 'rdv' } });
  });

  it('refuses a client belonging to another salon', async () => {
    prisma.client.findFirst.mockResolvedValue(null);
    await expect(service.forClient('client', 'salon')).rejects.toThrow(NotFoundException);
    expect(prisma.appointmentPhoto.findMany).not.toHaveBeenCalled();
  });

  it('scopes the client gallery to authorized appointments', async () => {
    prisma.client.findFirst.mockResolvedValue({ id: 'client' });
    await service.forClient('client', 'salon');
    expect(prisma.appointmentPhoto.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { appointment: { clientId: 'client', OR: [{ userId: 'salon' }, { performerUserId: 'salon' }] } },
    }));
  });
});
