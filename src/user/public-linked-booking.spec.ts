import { UserService } from './user.service';

describe('Public booking with a linked artist', () => {
  const artist = { id: 'raven', salonName: 'Raven', firstName: 'CJ', lastName: 'Raven', city: 'Paris', postalCode: '75013', saasPlan: 'FREE', appointmentBookingEnabled: false };
  const membership = { salonAllowsPublicBooking: true, artistAllowsPublicBooking: true, presence: { type: 'recurring', days: [1,2,3] }, artist, salon: { role: 'user_salon', saasPlan: 'BUSINESS' } };
  const cache = {} as any;
  const serviceFor = (member: object) => new UserService({} as any, cache, {} as any, { salonArtists: async () => [member] } as any);
  const profile = { id: 'gleamy', Tatoueur: [{ id: 'internal', name: 'Gravity', rdvBookingEnabled: true }] };

  it('lists an eligible FREE artist by their public profile name and preserves the salon in the redirect', async () => {
    const result = await (serviceFor(membership) as any).enrichSalonSlugUser(profile);
    expect(result.Tatoueur).toHaveLength(2);
    expect(result.Tatoueur[1]).toMatchObject({ name: 'Raven', isLinkedUser: true, rdvBookingEnabled: true, profileUserId: 'raven', bookingHref: '/salon/raven/paris-75013/reserver?venueSalonId=gleamy' });
  });
  it.each([
    { salonAllowsPublicBooking: false },
    { artistAllowsPublicBooking: false },
    { presence: null },
    { salon: { role: 'user_salon', saasPlan: 'PRO' } },
  ])('does not make the artist bookable when an actual requirement is missing: %o', async override => {
    const result = await (serviceFor({ ...membership, ...override }) as any).enrichSalonSlugUser(profile);
    expect(result.Tatoueur[1].rdvBookingEnabled).toBe(false);
  });
});
