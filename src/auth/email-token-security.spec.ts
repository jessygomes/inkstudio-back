/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { AuthService } from './auth.service';
import { emailTokenHash } from './email-token-policy';
jest.mock('bcryptjs', () => ({
  compare: jest.fn(async () => true),
  hash: jest.fn(async (value: string) => `hashed-${value}`),
}));

type Row = { id: string; email: string; token: string; expires: Date };
function fixture() {
  const user = {
    email: 'client@example.test',
    password: 'old-password',
    emailVerified: null as Date | null,
    role: 'client',
    firstName: 'Client',
    lastName: 'Test',
  };
  const stores = {
    verify: new Map<string, Row>(),
    reset: new Map<string, Row>(),
  };
  let sequence = 0;
  const model = (purpose: 'verify' | 'reset') => ({
    create: jest.fn(async ({ data }: any) => {
      const row = { ...data, id: String(++sequence) } as Row;
      stores[purpose].set(row.token, row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = stores[purpose].get(where.email_token.token);
      return row?.email === where.email_token.email ? row : null;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (const [key, row] of stores[purpose])
        if (
          row.email === where.email &&
          (!where.id || row.id === where.id) &&
          (!where.token || row.token === where.token) &&
          (!where.expires || row.expires > where.expires.gt)
        ) {
          stores[purpose].delete(key);
          count++;
        }
      return { count };
    }),
  });
  let tail = Promise.resolve();
  const prisma: any = {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
    },
    verificationToken: model('verify'),
    passwordResetToken: model('reset'),
    $transaction: async (work: (tx: any) => Promise<any>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshot = {
        user: { ...user },
        verify: new Map(stores.verify),
        reset: new Map(stores.reset),
      };
      try {
        return await work(prisma);
      } catch (error) {
        Object.assign(user, snapshot.user);
        stores.verify = snapshot.verify;
        stores.reset = snapshot.reset;
        throw error;
      } finally {
        release();
      }
    },
  };
  const mail = {
    sendClientEmailVerification: jest.fn(),
    sendPasswordReset: jest.fn(),
  };
  const service = new AuthService(
    prisma,
    {} as any,
    mail as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const issue = async (purpose: 'verify' | 'reset') => {
    if (purpose === 'verify')
      await service.login({
        authBody: { email: user.email, password: 'old-password' },
      });
    else await service.sendResetPasswordEmail(user.email);
    const calls =
      purpose === 'verify'
        ? mail.sendClientEmailVerification.mock.calls
        : mail.sendPasswordReset.mock.calls;
    const args = calls[calls.length - 1] as unknown as [
      string,
      { verificationUrl?: string; resetUrl?: string },
    ];
    return new URL(
      (args[1].verificationUrl || args[1].resetUrl)!,
    ).searchParams.get('token')!;
  };
  return { user, stores, prisma, mail, service, issue };
}

describe('Email verification and password reset tokens', () => {
  const previous = process.env.FRONTEND_URL;
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://app.example.test';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  });
  it.each(['verify', 'reset'] as const)(
    'issues a 256-bit %s token and stores only a purpose-bound hash',
    async (purpose) => {
      const { issue, stores } = fixture();
      const before = Date.now(),
        token = await issue(purpose);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const row = [...stores[purpose].values()][0];
      expect(row.token).toBe(emailTokenHash(purpose, token));
      expect(row.token).not.toContain(token);
      expect(row.expires.getTime()).toBeGreaterThanOrEqual(
        before + (purpose === 'verify' ? 10 : 15) * 60000,
      );
    },
  );
  it.each(['verify', 'reset'] as const)(
    'invalidates the previous %s link when issuing a new one',
    async (purpose) => {
      const { issue, service, user, stores } = fixture();
      const first = await issue(purpose),
        second = await issue(purpose);
      expect(first).not.toBe(second);
      expect(stores[purpose].size).toBe(1);
      await expect(
        purpose === 'verify'
          ? service.verifyEmail(user.email, first)
          : service.resetPassword({
              email: user.email,
              token: first,
              password: 'password123',
            }),
      ).rejects.toThrow();
    },
  );
  it.each(['verify', 'reset'] as const)(
    'allows only one concurrent consumption of a %s token',
    async (purpose) => {
      const { issue, service, user, prisma } = fixture();
      const token = await issue(purpose);
      const locksBefore = prisma.$queryRaw.mock.calls.length;
      const consume = () =>
        purpose === 'verify'
          ? service.verifyEmail(user.email, token)
          : service.resetPassword({
              email: user.email,
              token,
              password: 'password123',
            });
      const results = await Promise.allSettled([consume(), consume()]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.calls.length).toBe(locksBefore + 2);
      expect(prisma.$queryRaw.mock.calls.at(-1)[0].join('')).toContain(
        'FOR UPDATE',
      );
      await expect(consume()).rejects.toThrow();
      if (purpose === 'verify') expect(user.emailVerified).toBeInstanceOf(Date);
      else expect(user.password).toBe('hashed-password123');
    },
  );
  it.each(['expired', 'wrongEmail', 'wrongToken'] as const)(
    'rejects a %s verification link without changing the user',
    async (failure) => {
      const { issue, service, user, stores, prisma } = fixture();
      const token = await issue('verify');
      if (failure === 'expired')
        [...stores.verify.values()][0].expires = new Date(Date.now() - 1);
      await expect(
        service.verifyEmail(
          failure === 'wrongEmail' ? 'other@example.test' : user.email,
          failure === 'wrongToken' ? 'b'.repeat(64) : token,
        ),
      ).rejects.toThrow();
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );
  it.each(['verify', 'reset'] as const)(
    'rolls back token consumption if the %s account update fails',
    async (purpose) => {
      const { issue, service, user, stores, prisma } = fixture();
      const token = await issue(purpose);
      prisma.user.update.mockRejectedValueOnce(new Error('write failed'));
      const consume = () =>
        purpose === 'verify'
          ? service.verifyEmail(user.email, token)
          : service.resetPassword({
              email: user.email,
              token,
              password: 'password123',
            });
      await expect(consume()).rejects.toThrow('write failed');
      expect(stores[purpose].size).toBe(1);
      await expect(consume()).resolves.toBeDefined();
    },
  );
  it('cannot use a verification token to reset a password, even if its hash is copied', async () => {
    const { issue, service, user, stores, prisma } = fixture();
    const token = await issue('verify');
    const row = [...stores.verify.values()][0];
    stores.reset.set(row.token, row);
    await expect(
      service.resetPassword({
        email: user.email,
        token,
        password: 'password123',
      }),
    ).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('rejects a lost claim before updating the account', async () => {
    const { issue, service, user, prisma } = fixture();
    const token = await issue('verify');
    prisma.verificationToken.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verifyEmail(user.email, token)).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it.each(['123456', 'a'.repeat(64)])(
    'rejects legacy plaintext tokens: %s',
    async (token) => {
      const { service, user, stores, prisma } = fixture();
      stores.verify.set(token, {
        id: 'legacy',
        email: user.email,
        token,
        expires: new Date(Date.now() + 60000),
      });
      await expect(service.verifyEmail(user.email, token)).rejects.toThrow();
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );
  it.each(['short', '', 'é'.repeat(40)])(
    'refuses a weak or bcrypt-truncated reset password',
    async (password) => {
      const { service, user, prisma } = fixture();
      await expect(
        service.resetPassword({
          email: user.email,
          token: 'a'.repeat(64),
          password,
        }),
      ).rejects.toThrow();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    },
  );
  it('returns the same reset response for existing and missing users', async () => {
    const { service, user, prisma } = fixture();
    const existing = await service.sendResetPasswordEmail(user.email);
    prisma.user.findUnique.mockResolvedValue(null);
    expect(
      await service.sendResetPasswordEmail('missing@example.test'),
    ).toEqual(existing);
  });
});
