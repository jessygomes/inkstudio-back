import { TatoueursService } from './tatoueurs.service';

describe('Public appointment artist selection', () => {
  const member = {
    artist: { id: 'artist', role: 'user_tatoueur', salonName: 'Raven', city: 'Paris', postalCode: '75013', saasPlan: 'FREE' },
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
      .toEqual([expect.objectContaining({ linkedUserId: 'artist', profileUserId: 'artist', rdvBookingEnabled: true, appointmentBookingEnabled: true, bookingHref: '/salon/raven/paris-75013/reserver?venueSalonId=salon' })]);
  });

  it('uses the profile URL identity and preserves the selected salon in the redirect', async () => {
    const result = await serviceFor({ artist: { ...member.artist, nickname: 'Pseudo', salonName: 'L’Atelier Étoilé', city: 'Saint-Étienne' } })
      .getTatoueurByUserIdForAppointment('salon/2', true);
    expect(result[0]).toMatchObject({ name: 'Pseudo', bookingHref: '/salon/l-atelier-etoile/saint-etienne-75013/reserver?venueSalonId=salon%2F2' });
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

  it('also exposes public booking on the general artist list independently of salon creation permission', async () => {
    expect(await serviceFor().getTatoueurByUserId('salon', true))
      .toEqual([expect.objectContaining({ rdvBookingEnabled: true, appointmentBookingEnabled: true, bookingHref: '/salon/raven/paris-75013/reserver?venueSalonId=salon' })]);
    expect(await serviceFor().getTatoueurByUserId('salon'))
      .toEqual([expect.objectContaining({ rdvBookingEnabled: false })]);
  });

  it.each([{ salonAllowsPublicBooking: false }, { artistAllowsPublicBooking: false }, { presence: null }])
    ('does not enable public booking through the general list when permission or presence is missing: %o', async overrides => {
      expect(await serviceFor(overrides).getTatoueurByUserId('salon', true))
        .toEqual([expect.objectContaining({ rdvBookingEnabled: false, appointmentBookingEnabled: false })]);
    });
});
