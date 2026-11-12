import { ForbiddenException } from '@nestjs/common';
import { AppointmentDetailsService } from './appointment-details.service';

function build() {
  const prisma = {
    appointment: {
      findUnique: jest.fn().mockResolvedValue({ client: { firstName: 'Jeanne', lastName: 'Doe', email: 'j@d.fr', phone: '0600000000', linkedUser: { image: null } }, conversation: { id: 'conv-1' } }),
    },
  };
  const appointments = {
    assertAppointmentAccess: jest.fn().mockResolvedValue(undefined),
    getOneAppointment: jest.fn().mockResolvedValue({ id: 'rdv-1', title: 'Bras' }),
  };
  const photos = { list: jest.fn().mockResolvedValue([{ id: 'p1' }]) };
  const drawing = { getAppointmentCardStatus: jest.fn().mockResolvedValue({ cardExists: false }) };
  const service = new AppointmentDetailsService(prisma as never, appointments as never, photos as never, drawing as never);
  return { service, prisma, appointments, photos, drawing };
}

describe('AppointmentDetailsService.get', () => {
  it('renvoie le rendez-vous (avec client et conversation), les photos et le suivi de dessin', async () => {
    const { service } = build();
    const res = await service.get('salon-1', 'rdv-1');
    expect(res.appointment).toEqual({
      ok: true,
      data: { id: 'rdv-1', title: 'Bras', client: expect.objectContaining({ firstName: 'Jeanne', phone: '0600000000' }), conversation: { id: 'conv-1' } },
    });
    expect(res.photos).toEqual({ ok: true, data: [{ id: 'p1' }] });
    expect(res.drawingStatus).toEqual({ ok: true, data: { cardExists: false } });
  });

  it('ajoute la photo du compte People au client (accountImage)', async () => {
    const { service, prisma } = build();
    // Pas de photo liée ni de client connecté : recherche par e-mail.
    (prisma as unknown as { user: { findMany: jest.Mock } }).user = { findMany: jest.fn().mockResolvedValue([{ email: 'j@d.fr', image: 'https://img/j.webp' }]) };
    const res = await service.get('salon-1', 'rdv-1');
    expect(res.appointment).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ client: expect.objectContaining({ accountImage: 'https://img/j.webp' }) }) }));
  });

  it("vérifie l'accès avant tout et le refuse globalement", async () => {
    const { service, appointments, photos, drawing } = build();
    appointments.assertAppointmentAccess.mockRejectedValue(new ForbiddenException('Accès refusé.'));
    await expect(service.get('autre', 'rdv-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(appointments.getOneAppointment).not.toHaveBeenCalled();
    expect(photos.list).not.toHaveBeenCalled();
    expect(drawing.getAppointmentCardStatus).not.toHaveBeenCalled();
  });

  it("une erreur dans un bloc n'empêche pas les autres", async () => {
    const { service, photos } = build();
    photos.list.mockRejectedValue(new Error('boom'));
    const res = await service.get('salon-1', 'rdv-1');
    expect(res.photos).toEqual({ ok: false, status: 500, message: 'boom' });
    expect(res.appointment.ok).toBe(true);
    expect(res.drawingStatus.ok).toBe(true);
  });

  it('un rendez-vous introuvable ou en erreur est signalé dans son bloc', async () => {
    const { service, appointments } = build();
    appointments.getOneAppointment.mockResolvedValue({ error: true, message: 'Rendez-vous introuvable.' });
    const res = await service.get('salon-1', 'rdv-x');
    expect(res.appointment).toEqual({ ok: false, status: 500, message: 'Rendez-vous introuvable.' });
  });

  it('sans client ni conversation (ex. réservation sans fiche), les champs valent null', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue({ client: null, conversation: null });
    const res = await service.get('salon-1', 'rdv-1');
    expect(res.appointment).toEqual({ ok: true, data: { id: 'rdv-1', title: 'Bras', client: null, conversation: null } });
  });
});
