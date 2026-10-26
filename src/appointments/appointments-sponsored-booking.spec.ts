import { ForbiddenException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { PrestationType } from './dto/create-appointment.dto';
import { SkinTone } from './constants/skin-tone.constants';

describe('Public booking for a FREE artist in a Business salon', () => {
  let service: AppointmentsService;
  let db: any;
  let mail: any;
  let residencies: any;
  let artist: any;
  const sponsor = { id: 'business', salonName: 'Business Salon', email: 'salon@example.test', addConfirmationEnabled: true };
  const body = { prestation: PrestationType.PROJET, start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z', clientFirstname: 'Client', clientLastname: 'Test', clientEmail: 'client@example.test', clientPhone: '0100000000', tatoueurId: 'artist', venueSalonId: 'business', skin: SkinTone.MATE };
  beforeEach(() => {
    artist = { id: 'artist', role: 'user_tatoueur', salonName: 'Raven', email: 'artist@example.test', saasPlan: 'FREE', addConfirmationEnabled: false, projectAppointmentDurationMinutes: 60, projectAppointmentIsFree: true };
    db = {
      user: { findUnique: jest.fn(({ where }) => Promise.resolve(where.id === 'artist' ? artist : where.id === 'business' ? { role: 'user_salon', linkedTatoueurs: [] } : null)) },
      tatoueur: { findUnique: jest.fn().mockResolvedValue(null) },
      appointment: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      client: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(({data}) => Promise.resolve({id:'client',...data})) },
      tattooDetail: { create: jest.fn().mockResolvedValue({id:'details'}) },
    };
    mail = { sendPendingAppointmentNotification: jest.fn(), sendAutoConfirmedAppointment: jest.fn(), sendNewAppointmentNotification: jest.fn() };
    residencies = { businessSponsor: jest.fn().mockResolvedValue(sponsor), persistAppointment: jest.fn(({data}) => Promise.resolve({id:'appointment',...data})) };
    const cache = { del: jest.fn(), delPattern: jest.fn(), set: jest.fn() };
    service = new AppointmentsService(db, mail, {} as any, {} as any, {} as any, cache as any, {} as any, residencies);
  });
  it('creates the appointment and CRM client for the salon, preserves the artist, and notifies the salon', async () => {
    const result = await service.createByClient({ userId: 'artist', rdvBody: body });
    expect(result.error).toBe(false);
    expect(residencies.businessSponsor).toHaveBeenCalledWith('artist','business');
    expect(db.client.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({userId:'business'})}));
    expect(residencies.persistAppointment).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({userId:'business',performerUserId:'artist',venueSalonId:'business',status:'PENDING'})}),null,true);
    expect(mail.sendPendingAppointmentNotification).toHaveBeenCalledWith('salon@example.test',expect.anything(),'Business Salon');
  });
  it('refuses an ineligible or unrelated venue before creating any client or appointment', async () => {
    residencies.businessSponsor.mockRejectedValue(new ForbiddenException('Salon Business actif requis.'));
    const result = await service.createByClient({ userId:'artist', rdvBody:body });
    expect(result.error).toBe(true);
    expect(db.client.create).not.toHaveBeenCalled();
    expect(residencies.persistAppointment).not.toHaveBeenCalled();
  });
  it('keeps independent ownership for a PRO artist', async () => {
    artist.saasPlan = 'PRO';
    const result = await service.createByClient({ userId:'artist', rdvBody:body });
    expect(result.error).toBe(false);
    expect(residencies.businessSponsor).not.toHaveBeenCalled();
    expect(residencies.persistAppointment).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({userId:'artist',performerUserId:'artist'})}),null,true);
  });
});
