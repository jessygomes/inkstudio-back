import { ForbiddenException } from '@nestjs/common';
import { MoodboardService } from './moodboard.service';

describe('Appointment moodboard access', () => {
  let prisma: any;
  let service: MoodboardService;
  beforeEach(() => {
    prisma = {
      appointment: { findUnique: jest.fn().mockResolvedValue({ id: 'appointment', userId: 'salon', performerUserId: 'artist', clientUserId: 'client', moodboardId: null }), update: jest.fn() },
      moodboard: { findUnique: jest.fn().mockResolvedValue({ id: 'board', projectStatus: 'PRIVATE', clientProfile: { userId: 'client' }, images: [] }) },
      projectProposal: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new MoodboardService(prisma);
  });

  it('allows a client to attach their own private moodboard', async () => {
    await service.connectToAppointment('board', 'appointment', 'client');
    expect(prisma.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { moodboardId: 'board' } }));
  });
  it('retains the checked client, participant and previous link in the write predicate', async () => {
    await service.connectToAppointment('board', 'appointment', 'client');
    expect(prisma.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'appointment', clientUserId: 'client', moodboardId: null,
      OR: [{ clientUserId: 'client' }, { userId: 'client' }, { performerUserId: 'client' }],
    } }));
  });
  it('requires the exact checked board when disconnecting', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appointment', userId: 'salon', clientUserId: 'client', moodboardId: 'board' });
    await service.disconnectFromAppointment('board', 'appointment', 'client');
    expect(prisma.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'appointment', clientUserId: 'client', moodboardId: 'board' }), data: { moodboardId: null } }));
  });

  it('does not let the salon attach an unrelated private moodboard', async () => {
    await expect(service.connectToAppointment('board', 'appointment', 'salon')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('allows the salon or assigned artist to attach a moodboard after an accepted proposal', async () => {
    prisma.projectProposal.findFirst.mockResolvedValue({ id: 'accepted' });
    await service.connectToAppointment('board', 'appointment', 'salon');
    await service.connectToAppointment('board', 'appointment', 'artist');
    expect(prisma.appointment.update).toHaveBeenCalledTimes(2);
  });

  it('never attaches a moodboard belonging to another client', async () => {
    prisma.moodboard.findUnique.mockResolvedValue({ id: 'board', projectStatus: 'OPEN', clientProfile: { userId: 'other-client' } });
    await expect(service.connectToAppointment('board', 'appointment', 'salon')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('allows both appointment participants to read a linked private moodboard', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ userId: 'salon', performerUserId: 'artist', clientUserId: 'client', moodboardId: 'board' });
    for (const userId of ['client', 'salon', 'artist']) {
      await expect(service.getMoodboardByAppointment('appointment', userId)).resolves.toMatchObject({ moodboard: { id: 'board' } });
    }
    await expect(service.getMoodboardByAppointment('appointment', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
