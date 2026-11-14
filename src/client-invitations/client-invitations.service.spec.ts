import { createHash } from 'crypto';
import { ClientInvitationsService } from './client-invitations.service';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

type Inv = Record<string, any>;

function createDb() {
  const state = {
    users: new Map<string, any>([
      ['salon', { id: 'salon', role: 'user_salon', salonName: 'Studio Nord', email: 'salon@x.test' }],
      ['benoit', { id: 'benoit', role: 'client', email: 'Benoit@Mail.test', emailVerified: new Date('2026-11-01') }],
      ['autre', { id: 'autre', role: 'client', email: 'autre@mail.test', emailVerified: new Date('2026-11-01') }],
    ]),
    clients: [
      { id: 'fiche', userId: 'salon', email: 'benoit@mail.test', firstName: 'Benoît', lastName: 'Martin', linkedUserId: null as string | null },
    ] as any[],
    invitations: [] as Inv[],
  };
  const withClient = (inv: Inv | undefined) =>
    inv ? { ...inv, client: state.clients.find((c) => c.id === inv.clientId) } : null;
  const matches = (inv: Inv, where: any) =>
    Object.entries(where).every(([key, value]: [string, any]) => {
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('gt' in value) return inv[key] && inv[key] > value.gt;
      }
      return (inv[key] ?? null) === value;
    });
  const db: any = {
    state,
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (cb: any) => cb(db)),
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id ? state.users.get(where.id) ?? null : [...state.users.values()].find((u) => u.email === where.email) ?? null),
    },
    client: {
      findFirst: jest.fn(async ({ where }: any) =>
        state.clients.find((c) =>
          (!where.id || c.id === where.id) &&
          (!where.userId || c.userId === where.userId) &&
          (where.linkedUserId === undefined || c.linkedUserId === where.linkedUserId) &&
          (!where.NOT || c.id !== where.NOT.id)) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = state.clients.find((x) => x.id === where.id && x.userId === where.userId &&
          where.OR.some((o: any) => x.linkedUserId === o.linkedUserId));
        if (c) Object.assign(c, data);
        return { count: c ? 1 : 0 };
      }),
    },
    clientInvitation: {
      count: jest.fn(async ({ where }: any) => state.invitations.filter((i) => matches(i, where)).length),
      findFirst: jest.fn(async ({ where }: any) =>
        [...state.invitations].reverse().find((i) => matches(i, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => state.invitations.filter((i) => matches(i, where))),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const inv = state.invitations.find((i) => (where.id ? i.id === where.id : i.tokenHash === where.tokenHash));
        return include ? withClient(inv) : inv ?? null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const list = state.invitations.filter((i) => matches(i, where));
        list.forEach((i) => Object.assign(i, data));
        return { count: list.length };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const inv = state.invitations.find((i) => i.id === where.id)!;
        return Object.assign(inv, data);
      }),
      create: jest.fn(async ({ data }: any) => {
        const inv = { id: `inv-${state.invitations.length}`, createdAt: new Date(), emailSentAt: null, pendingUserId: null, acceptedAt: null, acceptedUserId: null, revokedAt: null, ...data };
        state.invitations.push(inv);
        return inv;
      }),
    },
  };
  return db;
}

describe('ClientInvitationsService', () => {
  let db: ReturnType<typeof createDb>;
  let mail: { sendMail: jest.Mock };
  let notifications: { notify: jest.Mock };
  let service: ClientInvitationsService;
  const tokenOf = (url: string) => url.split('/invitation/')[1];

  beforeEach(() => {
    db = createDb();
    mail = { sendMail: jest.fn().mockResolvedValue({}) };
    notifications = { notify: jest.fn().mockResolvedValue(null) };
    service = new ClientInvitationsService(db, mail as any, notifications as any);
  });

  it("crée un lien pour la fiche du salon, l'envoie par e-mail et ne stocke que son empreinte", async () => {
    const result = await service.create('salon', 'fiche', { sendEmail: true });
    expect(result.url).toMatch(/^https:\/\/theinkera\.com\/invitation\/[\w-]{40,}$/);
    expect(result.emailSent).toBe(true);
    expect(mail.sendMail).toHaveBeenCalledWith('benoit@mail.test', expect.stringContaining('Studio Nord'), expect.any(String), 'Studio Nord');
    expect(db.state.invitations[0]).toMatchObject({ email: 'benoit@mail.test', tokenHash: digest(tokenOf(result.url)) });
    expect(JSON.stringify(db.state.invitations)).not.toContain(tokenOf(result.url));
    expect(result.invitation?.status).toBe('ACTIVE');
  });

  it("refuse la fiche d'un autre salon, une fiche déjà reliée ou sans e-mail", async () => {
    await expect(service.create('autre-salon', 'fiche')).rejects.toThrow('Fiche client introuvable');
    db.state.clients[0].linkedUserId = 'benoit';
    await expect(service.create('salon', 'fiche')).rejects.toMatchObject({ response: { code: 'CLIENT_ALREADY_LINKED' } });
    db.state.clients[0].linkedUserId = null;
    db.state.clients[0].email = '';
    await expect(service.create('salon', 'fiche')).rejects.toMatchObject({ response: { code: 'CLIENT_EMAIL_REQUIRED' } });
  });

  it("garde les liens envoyés valables, annule les autres à l'acceptation et limite l'e-mail à un envoi par 24 h", async () => {
    const first = await service.create('salon', 'fiche', { sendEmail: true });
    await expect(service.create('salon', 'fiche', { sendEmail: true })).rejects.toMatchObject({ response: { code: 'INVITATION_EMAIL_COOLDOWN' } });
    const second = await service.create('salon', 'fiche');
    expect(db.state.invitations[0].revokedAt).toBeNull();
    await expect(service.accept(tokenOf(first.url), 'benoit')).resolves.toEqual({ linked: true, salonName: 'Studio Nord' });
    expect(db.state.invitations[1].revokedAt).toBeInstanceOf(Date);
    await expect(service.accept(tokenOf(second.url), 'autre')).rejects.toMatchObject({ response: { code: 'INVITATION_REVOKED' } });
  });

  it('montre la fiche seulement tant que le lien est valable', async () => {
    const { url } = await service.create('salon', 'fiche');
    await expect(service.publicInfo(tokenOf(url))).resolves.toMatchObject({
      status: 'ACTIVE', salonName: 'Studio Nord', firstName: 'Benoît', email: 'benoit@mail.test',
    });
    db.state.invitations[0].expiresAt = new Date(Date.now() - 1000);
    const expired = await service.publicInfo(tokenOf(url));
    expect(expired.status).toBe('EXPIRED');
    expect(expired).not.toHaveProperty('email');
    await expect(service.publicInfo('inconnu-'.repeat(5))).rejects.toMatchObject({ response: { code: 'INVITATION_NOT_FOUND' } });
  });

  it("relie la fiche au compte qui a l'e-mail de la fiche (casse ignorée)", async () => {
    const { url } = await service.create('salon', 'fiche');
    await service.accept(tokenOf(url), 'benoit');
    expect(db.state.clients[0].linkedUserId).toBe('benoit');
    expect(db.state.invitations[0]).toMatchObject({ acceptedUserId: 'benoit' });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'salon', type: 'client.account_linked', title: 'Benoît Martin a accepté votre invitation',
      data: { clientId: 'fiche', clientEmail: 'benoit@mail.test' },
    }));
    await expect(service.accept(tokenOf(url), 'benoit')).resolves.toMatchObject({ linked: true });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    await expect(service.accept(tokenOf(url), 'autre')).rejects.toMatchObject({ response: { code: 'INVITATION_USED' } });
  });

  it("refuse un compte avec un autre e-mail ou non vérifié", async () => {
    const { url } = await service.create('salon', 'fiche');
    await expect(service.accept(tokenOf(url), 'autre')).rejects.toMatchObject({ response: { code: 'EMAIL_MISMATCH' } });
    db.state.users.get('benoit').emailVerified = null;
    await expect(service.accept(tokenOf(url), 'benoit')).rejects.toMatchObject({ response: { code: 'EMAIL_NOT_VERIFIED' } });
    expect(db.state.clients[0].linkedUserId).toBeNull();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuse si le compte est déjà relié à une autre fiche du même salon', async () => {
    db.state.clients.push({ id: 'ancienne', userId: 'salon', email: 'vieux@mail.test', linkedUserId: 'benoit' });
    const { url } = await service.create('salon', 'fiche');
    await expect(service.accept(tokenOf(url), 'benoit')).rejects.toMatchObject({ response: { code: 'ACCOUNT_ALREADY_LINKED' } });
  });

  it("relie automatiquement à la vérification de l'e-mail un compte créé depuis le lien", async () => {
    const { url } = await service.create('salon', 'fiche');
    await service.rememberSignup(tokenOf(url), { id: 'benoit', email: 'benoit@mail.test' });
    expect(db.state.invitations[0].pendingUserId).toBe('benoit');
    await service.acceptPendingForEmail('Benoit@Mail.test');
    expect(db.state.clients[0].linkedUserId).toBe('benoit');
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'salon', title: 'Benoît Martin a rejoint Inkera' }));
  });

  it("ne retient pas une inscription faite avec un autre e-mail", async () => {
    const { url } = await service.create('salon', 'fiche');
    await service.rememberSignup(tokenOf(url), { id: 'autre', email: 'autre@mail.test' });
    expect(db.state.invitations[0].pendingUserId).toBeNull();
  });
});
