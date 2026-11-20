import { ForbiddenException } from '@nestjs/common';
import { BookingImagesController } from './booking-images.controller';
import { GUEST_UPLOAD_TOKEN_TTL_MS, issueGuestUploadToken, verifyGuestUploadToken } from './guest-upload-token';

describe('Jeton de visiteur pour les images de réservation (app People)', () => {
  const original = process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET;
  beforeEach(() => { process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET = 'x'.repeat(40); });
  afterAll(() => { process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET = original; });

  it('issues a signed token whose identifier the server verifies', () => {
    const issued = issueGuestUploadToken()!;
    const id = verifyGuestUploadToken(issued.guestToken);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(issued.guestToken.startsWith(`${id}.`)).toBe(true);
  });

  it('rejects a token chosen by the client (bad signature)', () => {
    const issued = issueGuestUploadToken()!;
    const [, expiry, signature] = issued.guestToken.split('.');
    expect(verifyGuestUploadToken(`00000000-0000-4000-8000-000000000000.${expiry}.${signature}`)).toBeNull();
    expect(verifyGuestUploadToken(`${issued.guestToken.slice(0, -1)}${issued.guestToken.endsWith('a') ? 'b' : 'a'}`)).toBeNull();
  });

  it('rejects an expired token and one with a stretched validity', () => {
    const issued = issueGuestUploadToken(Date.now() - GUEST_UPLOAD_TOKEN_TTL_MS - 1000)!;
    expect(verifyGuestUploadToken(issued.guestToken)).toBeNull();
    const future = issueGuestUploadToken(Date.now() + 10 * 60 * 60_000)!;
    expect(verifyGuestUploadToken(future.guestToken)).toBeNull();
  });

  it('rejects tokens signed with another secret, and works only when the secret is configured', () => {
    const issued = issueGuestUploadToken()!;
    process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET = 'y'.repeat(40);
    expect(verifyGuestUploadToken(issued.guestToken)).toBeNull();
    process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET = 'short';
    expect(issueGuestUploadToken()).toBeNull();
    expect(verifyGuestUploadToken(issued.guestToken)).toBeNull();
  });

  it('the upload route refuses a missing or forged token before storing anything', async () => {
    const uploads = { storeBookingGuestImages: jest.fn() };
    const controller = new BookingImagesController(uploads as never);
    await expect(controller.upload({ salonId: 'salon-1' }, [])).rejects.toThrow(ForbiddenException);
    await expect(controller.upload({ salonId: 'salon-1', guestToken: 'abc.123.def' }, [])).rejects.toThrow(ForbiddenException);
    expect(uploads.storeBookingGuestImages).not.toHaveBeenCalled();
  });

  it('the upload route stores images for the verified visitor', async () => {
    const uploads = { storeBookingGuestImages: jest.fn().mockResolvedValue([{ url: 'https://utfs.io/f/k1' }]) };
    const controller = new BookingImagesController(uploads as never);
    const { guestToken } = controller.guest();
    const id = guestToken.split('.')[0];
    await expect(controller.upload({ salonId: 'salon-1', guestToken }, [])).resolves.toEqual({ urls: ['https://utfs.io/f/k1'] });
    expect(uploads.storeBookingGuestImages).toHaveBeenCalledWith('salon-1', id, [], 2);
  });
});
