import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UploadQuotaService } from 'src/uploads/upload-quota.service';
import { AppointmentPhotoUploadService, detectImageKind } from './appointment-photo-upload.service';
import { AppointmentPhotosService } from './appointment-photos.service';
import { UploadStorage } from './upload-storage';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);

describe('detectImageKind', () => {
  it('recognises real images from their first bytes', () => {
    expect(detectImageKind(jpeg)).toBe('jpeg');
    expect(detectImageKind(png)).toBe('png');
    expect(detectImageKind(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]))).toBe('gif');
    expect(detectImageKind(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]))).toBe('webp');
    expect(detectImageKind(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)]))).toBe('heif');
    expect(detectImageKind(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(8)]))).toBe('avif');
  });

  it('rejects documents, scripts and truncated data', () => {
    expect(detectImageKind(pdf)).toBeNull();
    expect(detectImageKind(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(detectImageKind(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('AppointmentPhotoUploadService', () => {
  const photos = { authorize: jest.fn(), add: jest.fn() };
  const quota = { sign: jest.fn(), prepare: jest.fn(), complete: jest.fn(), deleted: jest.fn() };
  const storage = { upload: jest.fn(), delete: jest.fn() };
  const service = new AppointmentPhotoUploadService(
    photos as unknown as AppointmentPhotosService,
    quota as unknown as UploadQuotaService,
    storage as unknown as UploadStorage,
  );
  const file = (buffer = jpeg) => ({ buffer, size: buffer.length });

  beforeEach(() => {
    jest.resetAllMocks();
    photos.authorize.mockResolvedValue({ id: 'rdv' });
    photos.add.mockImplementation((_id, _user, dto) => Promise.resolve(dto.photos));
    quota.sign.mockImplementation((action, payload) => ({ body: { application: 'pro', payload: JSON.stringify(payload), timestamp: 1 }, signature: action }));
    quota.prepare.mockResolvedValue({ reservations: ['r1', 'r2'], ownerUserId: 'artist' });
    quota.complete.mockResolvedValue({ success: true });
    quota.deleted.mockResolvedValue({ success: true });
    storage.upload.mockImplementation((files: { customId: string }[]) => Promise.resolve(files.map((f, i) => ({ key: `key-${i}`, url: `https://utfs.io/f/key-${i}`, size: 10, customId: f.customId }))));
    storage.delete.mockResolvedValue(true);
  });

  it('refuses another account before reserving any quota or storing anything', async () => {
    photos.authorize.mockRejectedValue(new ForbiddenException());
    await expect(service.upload('rdv', 'stranger', [file()], 'Bearer x')).rejects.toThrow(ForbiddenException);
    expect(quota.prepare).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['no file', [] as ReturnType<typeof file>[]],
    ['six files', Array.from({ length: 6 }, () => file())],
    ['a non-image', [file(pdf)]],
    ['a file over 8 MB', [{ buffer: jpeg, size: 8 * 1024 * 1024 + 1 }]],
  ])('rejects %s without touching quota or storage', async (_name, files) => {
    await expect(service.upload('rdv', 'artist', files, 'Bearer x')).rejects.toThrow(BadRequestException);
    expect(quota.prepare).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('reserves quota with the detected type, uploads with the reservation as customId, confirms then saves', async () => {
    const result = await service.upload('rdv', 'artist', [file(jpeg), file(png)], 'Bearer token');
    expect(JSON.parse(quota.sign.mock.calls[0][1] ? JSON.stringify(quota.sign.mock.calls[0][1]) : '{}')).toEqual({
      route: 'imageUploader',
      files: [{ size: jpeg.length, type: 'image/jpeg' }, { size: png.length, type: 'image/png' }],
    });
    expect(quota.prepare).toHaveBeenCalledWith(expect.anything(), 'prepare', 'Bearer token');
    expect(storage.upload.mock.calls[0][0].map((f: { customId: string; type: string; name: string }) => [f.customId, f.type, f.name])).toEqual([
      ['r1', 'image/jpeg', 'photo-1.jpg'],
      ['r2', 'image/png', 'photo-2.png'],
    ]);
    expect(quota.sign).toHaveBeenCalledWith('complete', { id: 'r1', key: 'key-0', size: 10 });
    expect(quota.sign).toHaveBeenCalledWith('complete', { id: 'r2', key: 'key-1', size: 10 });
    expect(quota.complete).toHaveBeenCalledTimes(2);
    expect(photos.add).toHaveBeenCalledWith('rdv', 'artist', { photos: [{ url: 'https://utfs.io/f/key-0' }, { url: 'https://utfs.io/f/key-1' }] });
    expect(result).toHaveLength(2);
  });

  it('uses the sniffed type, not the one declared by the client', async () => {
    quota.prepare.mockResolvedValue({ reservations: ['r1'], ownerUserId: 'artist' });
    await service.upload('rdv', 'artist', [{ ...file(png), mimetype: 'image/jpeg' } as never], 'Bearer token');
    expect(storage.upload.mock.calls[0][0][0]).toMatchObject({ type: 'image/png', name: 'photo-1.png' });
  });

  it('rejects when the quota reservation belongs to a different account', async () => {
    quota.prepare.mockResolvedValue({ reservations: ['r1'], ownerUserId: 'someone-else' });
    await expect(service.upload('rdv', 'artist', [file()], 'Bearer token')).rejects.toThrow(UnauthorizedException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('removes already-stored files and releases them when one upload fails', async () => {
    storage.upload.mockResolvedValue([{ key: 'key-0', url: 'https://utfs.io/f/key-0', size: 10 }, null]);
    await expect(service.upload('rdv', 'artist', [file(), file(png)], 'Bearer token')).rejects.toThrow();
    expect(photos.add).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(['key-0']);
    expect(quota.sign).toHaveBeenCalledWith('deleted', { keys: ['key-0'] });
    expect(quota.deleted).toHaveBeenCalled();
  });

  it('cleans up the stored files when saving the photos fails', async () => {
    photos.add.mockRejectedValue(new Error('db down'));
    await expect(service.upload('rdv', 'artist', [file(), file(png)], 'Bearer token')).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledWith(['key-0', 'key-1']);
  });

  it('does not release quota when physical deletion is not confirmed', async () => {
    photos.add.mockRejectedValue(new Error('db down'));
    storage.delete.mockResolvedValue(false);
    await expect(service.upload('rdv', 'artist', [file(), file(png)], 'Bearer token')).rejects.toThrow('db down');
    expect(quota.deleted).not.toHaveBeenCalled();
  });
});
