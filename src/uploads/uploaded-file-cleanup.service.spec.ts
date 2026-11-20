import { UploadedFileCleanupService, uploadKeyFromUrl } from './uploaded-file-cleanup.service';

describe('uploadKeyFromUrl', () => {
  it.each([
    ['https://utfs.io/f/abc123', 'abc123'],
    ['https://mi9ikiadqr.ufs.sh/f/Ask8pvu_x-1?v=2', 'Ask8pvu_x-1'],
    ['https://uploadthing.com/legacyKey', 'legacyKey'],
  ])('extracts the key of %s', (url, key) => expect(uploadKeyFromUrl(url)).toBe(key));

  it.each([[null], [''], ['https://cdn.example.com/photo.jpg'], ['https://images.unsplash.com/photo-123']])(
    'ignores %s (not an UploadThing file)',
    (url) => expect(uploadKeyFromUrl(url as string | null)).toBeNull(),
  );
});

describe('UploadedFileCleanupService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const storage = { delete: jest.fn() };
  const quota = { sign: jest.fn(), deleted: jest.fn() };
  let service: UploadedFileCleanupService;

  beforeEach(() => {
    jest.resetAllMocks();
    quota.sign.mockImplementation((action, payload, application) => ({ body: { application, payload: JSON.stringify(payload) }, signature: action }));
    quota.deleted.mockResolvedValue({ success: true });
    storage.delete.mockResolvedValue(true);
    service = new UploadedFileCleanupService(prisma as never, storage as never, quota as never);
  });

  it('deletes an unused file and releases its quota in both upload contracts', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.deleteIfUnused(['https://utfs.io/f/k1'])).resolves.toEqual(['k1']);
    expect(storage.delete).toHaveBeenCalledWith(['k1']);
    expect(quota.sign).toHaveBeenCalledWith('deleted', { keys: ['k1'] }, 'pro');
    expect(quota.sign).toHaveBeenCalledWith('deleted', { keys: ['k1'] }, 'public');
  });

  it('keeps a file still referenced elsewhere (e.g. a flash visual copied into appointment photos)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(service.deleteIfUnused(['https://utfs.io/f/shared'])).resolves.toEqual([]);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(quota.deleted).not.toHaveBeenCalled();
  });

  it('only deletes the unused keys, once each, and ignores empty or foreign URLs', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ x: 1 }]);
    await service.deleteIfUnused(['https://utfs.io/f/a', 'https://utfs.io/f/a', 'https://utfs.io/f/b', null, undefined, 'https://cdn.example.com/x.jpg']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith(['a']);
  });

  it('does not release quota when UploadThing does not confirm the deletion', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    storage.delete.mockResolvedValue(false);
    await expect(service.deleteIfUnused(['https://utfs.io/f/k1'])).resolves.toEqual([]);
    expect(quota.deleted).not.toHaveBeenCalled();
  });

  it('never throws (database down)', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    await expect(service.deleteIfUnused(['https://utfs.io/f/k1'])).resolves.toEqual([]);
  });

  it('escapes LIKE wildcards of the key in the usage query', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.isUsed('a_b%c');
    const sql = prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values[0]).toBe('%a\\_b\\%c%');
  });
});
