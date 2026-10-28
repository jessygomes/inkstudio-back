import { TatoueursService } from './tatoueurs.service';

describe('Public appointment artist selection', () => {
  const member = {
    artist: { id: 'artist', role: 'user_tatoueur', salonName: 'Raven', saasPlan: 'FREE' },
    salon: { role: 'user_salon', saasPlan: 'BUSINESS' },
    salonAllowsPublicBooking: true,
    artistAllowsPublicBooking: true,
    artistAllowsSalonCreate: false,
    presence: { type: 'recurring', days: [1] },
  };
  const serviceFor = (overrides = {}) => new TatoueursService(
    { tatoueur: { findMany: jest.fn().mockResolvedValue([]) } } as any,
    {} as any,
    { salonArtists: jest.fn().mockResolvedValue([{ ...member, ...overrides }]) } as any,
  );

  it('offers a FREE artist in a Business salon using public permissions independently of internal creation', async () => {
    expect(await serviceFor().getTatoueurByUserIdForAppointment('salon', true))
      .toEqual([expect.objectContaining({ linkedUserId: 'artist', rdvBookingEnabled: true, appointmentBookingEnabled: true })]);
  });

  it.each([
    { salonAllowsPublicBooking: false },
    { artistAllowsPublicBooking: false },
    { presence: null },
    { artist: { ...member.artist, publicVisibility: 'HIDDEN' } },
    { salon: { role: 'user_salon', saasPlan: 'PRO' } },
  ])('excludes an artist missing public eligibility: %o', async overrides => {
    expect(await serviceFor(overrides).getTatoueurByUserIdForAppointment('salon', true)).toEqual([]);
  });

  it('still requires internal creation permission for the salon management selection', async () => {
    expect(await serviceFor().getTatoueurByUserIdForAppointment('salon')).toEqual([]);
    expect(await serviceFor({ artistAllowsSalonCreate: true }).getTatoueurByUserIdForAppointment('salon'))
      .toHaveLength(1);
  });
});
