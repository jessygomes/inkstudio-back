import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddAppointmentPhotosDto } from './add-appointment-photos.dto';

describe('AddAppointmentPhotosDto', () => {
  it.each([
    { photos: [] },
    { photos: Array.from({ length: 6 }, () => ({ url: 'https://example.com/photo.jpg' })) },
    { photos: [{ url: 'javascript:alert(1)' }] },
    { photos: [{ url: 'http://example.com/photo.jpg' }] },
    { photos: [{ url: 'https://example.com/photo.jpg', caption: 'x'.repeat(501) }] },
  ])('rejects invalid payload %#', async (payload) => {
    expect(await validate(plainToInstance(AddAppointmentPhotosDto, payload))).not.toHaveLength(0);
  });

  it('accepts an HTTPS image with an optional caption', async () => {
    expect(await validate(plainToInstance(AddAppointmentPhotosDto, { photos: [{ url: 'https://example.com/photo.jpg', caption: 'Après séance' }] }))).toHaveLength(0);
  });
});
