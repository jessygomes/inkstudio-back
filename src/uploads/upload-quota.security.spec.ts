/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import { UploadQuotaService } from './upload-quota.service';
import { attachGuestUploads } from './guest-upload-attachment';
import { SignedUploadDto } from './uploads.dto';

const MB = 1024 * 1024,
  secret = 'upload-quota-tests-only-secret-at-least-32-bytes';
function fixture() {
  const users: any[] = [
    { id: 'owner', role: 'user_salon' },
    { id: 'consumer', role: 'client' },
    {
      id: 'salon',
      role: 'user_salon',
      publicVisibility: 'VISIBLE',
      saasPlan: 'PRO',
    },
  ];
  const follows: any[] = [
    {
      id: 'follow',
      token: 'follow-token',
      status: 'PENDING',
      submissionId: null,
      expiresAt: new Date(Date.now() + 600000),
    },
  ];
  let rows: any[] = [],
    files: any[] = [];
  const matches = (row: any, where: any): boolean =>
    !where ||
    Object.entries(where).every(([key, value]: any) => {
      if (key === 'OR') return value.some((part: any) => matches(row, part));
      if (value && typeof value === 'object' && !(value instanceof Date))
        return Object.entries(value).every(([op, expected]: any) =>
          op === 'in'
            ? expected.includes(row[key])
            : op === 'not'
              ? row[key] !== expected
              : op === 'gte'
                ? row[key] >= expected
                : op === 'lt'
                  ? row[key] < expected
                  : true,
        );
      return row[key] === value;
    });
  let tail = Promise.resolve();
  const db: any = {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          users.find((user) => user.id === where.id) || null,
      ),
    },
    client: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 'client' && where.userId === 'owner'
          ? { id: 'client' }
          : null,
      ),
    },
    followUpRequest: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          follows.find((row) => matches(row, where)) || null,
      ),
    },
    salonResidency: { findMany: jest.fn(async () => []) },
    uploadedFile: {
      upsert: jest.fn(async ({ create }: any) => {
        let row = files.find(
          (row) =>
            row.key === create.key && row.application === create.application,
        );
        if (!row) {
          row = create;
          files.push(row);
        }
        return row;
      }),
    },
    uploadReservation: {
      aggregate: jest.fn(async ({ where }: any) => {
        const selected = rows.filter((row) => matches(row, where));
        return {
          _sum: { bytes: selected.reduce((n, row) => n + row.bytes, 0) },
          _count: selected.length,
        };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: randomUUID(),
          status: 'RESERVED',
          key: null,
          attachedAt: null,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: any) =>
          rows.find((row) => matches(row, where)) || null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = rows.find((row) => matches(row, where));
        if (!row) throw Error('missing');
        return { ...row };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        rows
          .filter((row) => matches(row, where))
          .slice(0, 100)
          .map((row) => ({ ...row })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((row) => matches(row, where));
        if (!row) throw Error('missing');
        return Object.assign(row, data);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows)
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        return { count };
      }),
    },
    $transaction: async (work: (tx: any) => Promise<any>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => (release = resolve));
      await previous;
      const before = rows.map((row) => ({ ...row })),
        beforeFiles = [...files];
      try {
        return await work(db);
      } catch (e) {
        rows = before;
        files = beforeFiles;
        throw e;
      } finally {
        release();
      }
    },
  };
  const jwt = new JwtService({ secret: 'quota-jwt-tests-only-secret' });
  const service = new UploadQuotaService(db, jwt);
  const signed = (
    action: string,
    value: object,
    application: 'pro' | 'public' = 'pro',
  ) => {
    const body: SignedUploadDto = {
      application,
      payload: JSON.stringify(value),
      timestamp: Date.now(),
    };
    const signature = createHmac('sha256', secret)
      .update(
        JSON.stringify([
          'upload-v2',
          action,
          application,
          body.payload,
          body.timestamp,
        ]),
      )
      .digest('hex');
    return { body, signature };
  };
  const auth = (id = 'owner', role = 'user_salon') =>
    `Bearer ${jwt.sign({ userId: id, role })}`;
  const prepare = async (
    value: object = {},
    who: string | null = auth(),
    application: 'pro' | 'public' = 'pro',
  ) => {
    const { body, signature } = signed(
      'prepare',
      {
        route: 'imageUploader',
        files: [{ size: 10, type: 'image/png' }],
        ...value,
      },
      application,
    );
    return service.prepare(body, signature, who ?? undefined);
  };
  const complete = async (
    id: string,
    key = 'photo.png',
    size = 10,
    application: 'pro' | 'public' = 'pro',
  ) => {
    const { body, signature } = signed(
      'complete',
      { id, key, size },
      application,
    );
    return service.complete(body, signature);
  };
  const cleanup = async (
    value: object = {},
    application: 'pro' | 'public' = 'pro',
  ) => {
    const { body, signature } = signed('abandoned', value, application);
    return service.abandoned(body, signature);
  };
  return {
    db,
    users,
    follows,
    jwt,
    service,
    signed,
    auth,
    prepare,
    complete,
    cleanup,
    get rows() {
      return rows;
    },
    get files() {
      return files;
    },
  };
}

describe('Upload authorization, budgets and callbacks', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.JWT_SECRET = 'quota-jwt-tests-only-secret';
    process.env.UPLOAD_OWNERSHIP_PRO_SECRET = secret;
    process.env.UPLOAD_OWNERSHIP_PUBLIC_SECRET = secret;
    for (const key of Object.keys(process.env))
      if (key.startsWith('UPLOAD_') && key.endsWith('_MB'))
        delete process.env[key];
  });
  afterEach(() => {
    for (const key of Object.keys(process.env))
      if (key.startsWith('UPLOAD_') || key === 'JWT_SECRET') {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
  });
  it('reserves the maximum possible transfer size before issuing file IDs', async () => {
    const f = fixture(),
      result = await f.prepare();
    expect(result.reservations).toHaveLength(1);
    expect(f.rows[0].bytes).toBe(8 * MB);
    expect(f.rows[0].ownerUserId).toBe('owner');
    expect(f.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.db.uploadReservation.aggregate.mock.invocationCallOrder[0],
    );
  });
  it.each(['signature', 'timestamp', 'application', 'action'])(
    'rejects a bad signed envelope: %s',
    async (failure) => {
      const f = fixture(),
        { body, signature } = f.signed('prepare', {
          route: 'imageUploader',
          files: [{ size: 10, type: 'image/png' }],
        });
      if (failure === 'timestamp') body.timestamp -= 600000;
      if (failure === 'application') body.application = 'public';
      await expect(
        failure === 'action'
          ? f.service.complete(body, signature)
          : f.service.prepare(
              body,
              failure === 'signature' ? '0'.repeat(64) : signature,
              f.auth(),
            ),
      ).rejects.toThrow();
      expect(f.rows).toHaveLength(0);
    },
  );
  it('never treats supplied invalid credentials as an anonymous guest', async () => {
    const f = fixture();
    await expect(
      f.prepare({ followUpToken: 'follow-token' }, 'Bearer forged'),
    ).rejects.toThrow();
    expect(f.rows).toHaveLength(0);
  });
  it('checks the database role instead of trusting a stale or forged JWT role', async () => {
    const f = fixture();
    await expect(f.prepare({}, f.auth('consumer', 'admin'))).rejects.toThrow();
    expect(f.rows).toHaveLength(0);
  });
  it.each(['noContext', 'noCookie', 'privateProfile', 'freeProfile'])(
    'refuses unrestricted guest uploads: %s',
    async (failure) => {
      const f = fixture();
      const input: any = { bookingSalonId: 'salon', guestId: 'guest' };
      if (failure === 'noContext') delete input.bookingSalonId;
      if (failure === 'noCookie') delete input.guestId;
      if (failure === 'privateProfile') f.users[2].publicVisibility = 'HIDDEN';
      if (failure === 'freeProfile') f.users[2].saasPlan = 'FREE';
      await expect(f.prepare(input, null, 'public')).rejects.toThrow();
      expect(f.rows).toHaveLength(0);
    },
  );
  it('allows contextual booking uploads without inventing an account owner', async () => {
    const f = fixture();
    await f.prepare(
      { bookingSalonId: 'salon', guestId: 'guest' },
      null,
      'public',
    );
    expect(f.rows[0]).toMatchObject({
      ownerUserId: null,
      contextType: 'booking',
      contextId: 'salon',
    });
  });
  it('keeps the FREE artist sponsored by an active Business salon eligible', async () => {
    const f = fixture();
    f.users[2].role = 'user_tatoueur';
    f.users[2].saasPlan = 'FREE';
    f.db.salonResidency.findMany.mockResolvedValue([
      {
        salon: {
          role: 'user_salon',
          saasPlan: 'BUSINESS',
          publicVisibility: 'VISIBLE',
        },
      },
    ]);
    await expect(
      f.prepare({ bookingSalonId: 'salon', guestId: 'guest' }, null, 'public'),
    ).resolves.toBeDefined();
  });
  it.each(['used', 'expired', 'expiredStatus', 'missing'])(
    'refuses a %s follow-up capability',
    async (failure) => {
      const f = fixture();
      if (failure === 'used') f.follows[0].status = 'SUBMITTED';
      if (failure === 'expiredStatus') f.follows[0].status = 'EXPIRED';
      if (failure === 'expired') f.follows[0].expiresAt = new Date(0);
      await expect(
        f.prepare(
          { followUpToken: failure === 'missing' ? 'unknown' : 'follow-token' },
          null,
        ),
      ).rejects.toThrow();
    },
  );
  it('allows a valid follow-up link and gives its own bounded guest budget', async () => {
    const f = fixture();
    await f.prepare({ followUpToken: 'follow-token' }, null);
    expect(f.rows[0]).toMatchObject({
      ownerUserId: null,
      budgetKey: 'follow-up:follow',
      contextType: 'follow-up',
    });
  });
  it.each(['missing', 'foreign', 'clientRole'])(
    'requires the owned CRM client for a consent PDF: %s',
    async (failure) => {
      const f = fixture();
      await expect(
        f.prepare(
          {
            route: 'consentPdf',
            files: [{ size: 10, type: 'application/pdf' }],
            consentClientId:
              failure === 'missing'
                ? undefined
                : failure === 'foreign'
                  ? 'other'
                  : 'client',
          },
          failure === 'clientRole' ? f.auth('consumer') : f.auth(),
        ),
      ).rejects.toThrow();
    },
  );
  it('accepts a professional consent for its owned CRM client', async () => {
    const f = fixture();
    await f.prepare({
      route: 'consentPdf',
      files: [{ size: 10, type: 'application/pdf' }],
      consentClientId: 'client',
    });
    expect(f.rows[0].contextId).toBe('client');
  });
  it.each([
    { type: 'image/svg+xml', size: 10 },
    { type: 'application/pdf', size: 10 },
    { type: 'image/png', size: 8 * MB + 1 },
    { type: 'image/png', size: 0 },
  ])('rejects unsupported image input %p', async (file) => {
    const f = fixture();
    await expect(f.prepare({ files: [file] })).rejects.toThrow();
    expect(f.rows).toHaveLength(0);
  });
  it('checks the total mixed document count, not a separate quota per MIME type', async () => {
    const f = fixture();
    await expect(
      f.prepare({
        route: 'salonDocuments',
        files: [
          { size: 10, type: 'application/pdf' },
          { size: 10, type: 'image/png' },
        ],
      }),
    ).rejects.toThrow();
  });
  it('shares a quota across applications and serializes concurrent reservations', async () => {
    process.env.UPLOAD_PRO_TOTAL_MB = '8';
    const f = fixture();
    const results = await Promise.allSettled([
      f.prepare(),
      f.prepare({}, f.auth(), 'public'),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(f.rows).toHaveLength(1);
  });
  it('does not refund an expired reservation until storage cleanup is confirmed', async () => {
    process.env.UPLOAD_PRO_TOTAL_MB = '8';
    const f = fixture();
    await f.prepare();
    f.rows[0].expiresAt = new Date(0);
    await expect(f.prepare()).rejects.toThrow();
    expect(f.rows[0].status).toBe('RESERVED');
  });
  it('applies the aggregate guest storage ceiling even if cookie IDs rotate', async () => {
    process.env.UPLOAD_GUEST_POOL_MB = '8';
    const f = fixture();
    await f.prepare(
      { bookingSalonId: 'salon', guestId: 'first' },
      null,
      'public',
    );
    await expect(
      f.prepare({ bookingSalonId: 'salon', guestId: 'second' }, null, 'public'),
    ).rejects.toThrow();
  });
  it('registers ownership and actual size atomically with an idempotent callback', async () => {
    const f = fixture(),
      result = await f.prepare();
    await f.complete(result.reservations[0]);
    await f.complete(result.reservations[0]);
    expect(f.rows[0]).toMatchObject({
      status: 'COMPLETE',
      bytes: 10,
      key: 'photo.png',
    });
    expect(f.files[0].ownerUserId).toBe('owner');
    expect(f.db.uploadedFile.upsert).toHaveBeenCalledTimes(1);
  });
  it.each(['late', 'tooLarge', 'differentKey', 'wrongApplication'])(
    'rejects an invalid completion: %s',
    async (failure) => {
      const f = fixture(),
        result = await f.prepare();
      if (failure === 'late') f.rows[0].expiresAt = new Date(0);
      if (failure === 'differentKey') await f.complete(result.reservations[0]);
      await expect(
        f.complete(
          result.reservations[0],
          failure === 'differentKey' ? 'other.png' : 'photo.png',
          failure === 'tooLarge' ? 8 * MB + 1 : 10,
          failure === 'wrongApplication' ? 'public' : 'pro',
        ),
      ).rejects.toThrow();
    },
  );
  it('revalidates resource permissions at completion', async () => {
    const f = fixture(),
      result = await f.prepare({
        route: 'consentPdf',
        files: [{ size: 10, type: 'application/pdf' }],
        consentClientId: 'client',
      });
    f.db.client.findFirst.mockResolvedValue(null);
    await expect(f.complete(result.reservations[0])).rejects.toThrow();
    expect(f.rows[0].status).toBe('RESERVED');
  });
  it('rolls back ownership registration if the reservation update fails', async () => {
    const f = fixture(),
      result = await f.prepare();
    f.db.uploadReservation.update.mockRejectedValue(new Error('failure'));
    await expect(f.complete(result.reservations[0])).rejects.toThrow();
    expect(f.files).toHaveLength(0);
    expect(f.rows[0].status).toBe('RESERVED');
  });
  it('marks a used guest upload before cleanup and retains it', async () => {
    const f = fixture(),
      result = await f.prepare(
        { bookingSalonId: 'salon', guestId: 'guest' },
        null,
        'public',
      );
    await f.complete(result.reservations[0], 'photo.png', 10, 'public');
    f.rows[0].createdAt = new Date(Date.now() - 48 * 3600000);
    await attachGuestUploads(
      f.db,
      ['https://test.ufs.sh/f/photo.png'],
      'booking',
      ['salon'],
    );
    expect(f.rows[0].attachedAt).toBeInstanceOf(Date);
    expect(await f.cleanup({ claim: true }, 'public')).toHaveLength(0);
  });
  it('claims abandoned guests before deleting and blocks a simultaneous attachment', async () => {
    const f = fixture(),
      result = await f.prepare(
        { bookingSalonId: 'salon', guestId: 'guest' },
        null,
        'public',
      );
    await f.complete(result.reservations[0], 'photo.png', 10, 'public');
    f.rows[0].createdAt = new Date(Date.now() - 48 * 3600000);
    expect(await f.cleanup({}, 'public')).toHaveLength(1);
    expect(f.rows[0].status).toBe('COMPLETE');
    await f.cleanup({ claim: true }, 'public');
    expect(f.rows[0].status).toBe('CLEANING');
    await expect(
      attachGuestUploads(f.db, ['https://test.ufs.sh/f/photo.png'], 'booking', [
        'salon',
      ]),
    ).rejects.toThrow();
    await f.cleanup({ confirmedIds: [f.rows[0].id] }, 'public');
    expect(f.rows[0].status).toBe('DELETED');
  });
  it('never automatically cleans completed account uploads', async () => {
    const f = fixture(),
      result = await f.prepare();
    await f.complete(result.reservations[0]);
    f.rows[0].createdAt = new Date(0);
    expect(await f.cleanup({ claim: true })).toHaveLength(0);
    expect(f.rows[0].status).toBe('COMPLETE');
  });
  it('retains quota after immediate physical deletion until the presigned URL has expired and cleanup confirms storage absence', async () => {
    process.env.UPLOAD_PRO_TOTAL_MB = '8';
    const f = fixture(),
      prepared = await f.prepare();
    await f.complete(prepared.reservations[0]);
    const { body, signature } = f.signed('deleted', { keys: ['photo.png'] });
    await f.service.deleted(body, signature);
    expect(f.rows[0].status).toBe('CLEANING');
    // Actual bytes are 10; reserve a full second 8MiB, which still exceeds the cap.
    await expect(f.prepare()).rejects.toThrow();
    expect(await f.cleanup({ claim: true })).toHaveLength(0);
    f.rows[0].createdAt = new Date(Date.now() - 48 * 3600000);
    await f.cleanup({ claim: true });
    await f.cleanup({ confirmedIds: [f.rows[0].id] });
    expect(f.rows[0].status).toBe('DELETED');
    await expect(f.prepare()).resolves.toBeDefined();
  });
  it('bounds the number of guest files even if every completed file is tiny', async () => {
    process.env.UPLOAD_GUEST_POOL_FILES = '1';
    const f = fixture();
    const prepared = await f.prepare(
      { bookingSalonId: 'salon', guestId: 'first' },
      null,
      'public',
    );
    await f.complete(prepared.reservations[0], 'tiny.png', 1, 'public');
    await expect(
      f.prepare({ bookingSalonId: 'salon', guestId: 'second' }, null, 'public'),
    ).rejects.toThrow();
  });
});
