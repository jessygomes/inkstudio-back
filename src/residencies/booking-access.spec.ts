import { canBookLinkedArtist, hasActiveBusiness } from './booking-access';

describe('Business booking sponsorship', () => {
  const now = new Date('2026-10-26T12:00Z');
  const business = { role: 'user_salon', saasPlan: 'BUSINESS' };
  it('allows FREE artists only with a Business salon and keeps PRO artists independent', () => {
    expect(canBookLinkedArtist({ saasPlan: 'FREE' }, business)).toBe(true);
    expect(canBookLinkedArtist({ saasPlan: 'FREE' }, { ...business, saasPlan: 'PRO' })).toBe(false);
    expect(canBookLinkedArtist({ saasPlan: 'FREE' }, { ...business, saasPlan: 'FREE' })).toBe(false);
    expect(canBookLinkedArtist({ saasPlan: 'FREE' }, { ...business, role: 'user_tatoueur' })).toBe(false);
    expect(canBookLinkedArtist({ saasPlan: 'PRO' }, { ...business, saasPlan: 'PRO' })).toBe(true);
  });
  it('accepts paid or gifted Business access and preserves existing cancellation/payment grace periods', () => {
    expect(hasActiveBusiness({ ...business, saasPlanUntil: '2027-01-01', saasPlanDetails: { currentPlan: 'BUSINESS', planStatus: 'ACTIVE' } }, now)).toBe(true);
    expect(hasActiveBusiness({ ...business, saasPlanUntil: '2026-10-26T12:00Z' }, now)).toBe(false);
    expect(hasActiveBusiness({ ...business, saasPlanDetails: { currentPlan: 'BUSINESS', planStatus: 'EXPIRED' } }, now)).toBe(false);
    for (const planStatus of ['PAST_DUE', 'CANCELED']) expect(hasActiveBusiness({ ...business, saasPlanDetails: { currentPlan: 'BUSINESS', planStatus, endDate: '2027-01-01' } }, now)).toBe(true);
    expect(hasActiveBusiness({ ...business, saasPlanDetails: { currentPlan: 'BUSINESS', planStatus: 'TRIAL', trialEndDate: '2026-10-27' } }, now)).toBe(true);
    expect(hasActiveBusiness({ ...business, saasPlanDetails: { currentPlan: 'BUSINESS', planStatus: 'TRIAL', trialEndDate: '2026-10-25' } }, now)).toBe(false);
  });
});
