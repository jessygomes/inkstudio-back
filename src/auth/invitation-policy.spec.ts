import { invitationEndDate, invitationTokenHash } from './invitation-policy';

describe('invitation policy', () => {
  it.each([
    ['2024-02-29T12:34:56Z', 12, '2025-02-28T12:34:56.000Z'],
    ['2026-01-31T12:34:56Z', 1, '2026-02-28T12:34:56.000Z'],
    ['2026-10-26T12:34:56Z', 12, '2027-10-26T12:34:56.000Z'],
  ])(
    'adds calendar months and preserves the time',
    (start, months, expected) => {
      expect(
        invitationEndDate(new Date(start), months as number).toISOString(),
      ).toBe(expected);
    },
  );

  it('hashes the invitation secret deterministically without storing the secret', () => {
    expect(invitationTokenHash('secret')).toHaveLength(64);
    expect(invitationTokenHash('secret')).toBe(invitationTokenHash('secret'));
    expect(invitationTokenHash('secret')).not.toBe(
      invitationTokenHash('another-secret'),
    );
  });
});
