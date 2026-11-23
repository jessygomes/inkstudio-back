import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { makeUser } from './giveaway-profile.spec';
import { EligibilityUser } from './giveaway-profile';
import { GiveawaysAdminService, csvCell } from './giveaways-admin.service';
import { GiveawaysService } from './giveaways.service';
import { inkera20262027Definition } from './inkera-2026-2027';
import { GiveawayAdminGuard } from './giveaway-admin.guard';

/* ---------- Petite base en mémoire (seulement ce que le module utilise) ---------- */

let seq = 0;
const id = (p: string) => `${p}${String(++seq).padStart(4, '0')}`;

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => matches(row, w));
    if (k === 'NOT') return !matches(row, v);
    if (v === undefined) return true;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('notIn' in v) return !v.notIn.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('hasSome' in v) return (row[k] ?? []).some((x: string) => v.hasSome.includes(x));
      if ('is' in v && v.is === null) return !row[`_${k}`];
      if ('none' in v) return !row[`_${k}`];
      if (k === 'drawResult') return db.state.results.some((r: any) => r.id === row.drawResultId && matches(r, v));
      if (k === 'entry') return matches(db.state.entries.find((e: any) => e.id === row.entryId), v);
      return false;
    }
    return (row[k] ?? null) === v;
  });
}

const dup = () => new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' });

function table(rows: any[], unique: (r: any) => string[] = () => []) {
  return {
    findUnique: jest.fn(async ({ where }: any) => {
      const key = Object.keys(where)[0];
      if (key === 'giveawayId_userId') return rows.find((r) => r.giveawayId === where[key].giveawayId && r.userId === where[key].userId) ?? null;
      return rows.find((r) => r[key] === where[key]) ?? null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id)),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy?.rank === 'asc') found.sort((a, b) => a.rank - b.rank);
      return found[0] ?? null;
    }),
    findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy?.id === 'asc') found.sort((a, b) => (a.id < b.id ? -1 : 1));
      return found;
    }),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: id('r'), createdAt: new Date(), ...data };
      for (const key of unique(row)) if (key && rows.some((r) => unique(r).includes(key))) throw dup();
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const found = rows.filter((r) => matches(r, where));
      found.forEach((r) => Object.assign(r, data));
      return { count: found.length };
    }),
    groupBy: jest.fn(async ({ by, where }: any) => {
      const groups = new Map<string, any>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const k = by.map((b: string) => r[b]).join('|');
        const g = groups.get(k) ?? { ...Object.fromEntries(by.map((b: string) => [b, r[b]])), _count: { _all: 0 } };
        g._count._all++;
        groups.set(k, g);
      }
      return [...groups.values()];
    }),
  };
}

let db: any;
function createDb() {
  const state = { giveaways: [] as any[], entries: [] as any[], draws: [] as any[], results: [] as any[], awards: [] as any[], audit: [] as any[] };
  const d: any = {
    state,
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(d) : Promise.all(arg))),
    giveaway: table(state.giveaways),
    giveawayEntry: table(state.entries, (r) => [r.userId ? `${r.giveawayId}:${r.userId}` : '']),
    giveawayDraw: table(state.draws, (r) => [r.officialKey ? `official:${r.officialKey}` : '']),
    giveawayDrawResult: table(state.results, (r) => [`${r.drawId}:${r.rank}`, `${r.drawId}:e:${r.entryId}`]),
    giveawayAward: table(state.awards, (r) => [`dr:${r.drawResultId}`]),
    giveawayAuditLog: table(state.audit),
  };
  // Relations utilisées par les filtres `award: { is: null }` / `awards: { none: {} }`.
  const createResult = d.giveawayDrawResult.create;
  const createAward = d.giveawayAward.create;
  d.giveawayAward.create = jest.fn(async (args: any) => {
    const award = await createAward(args);
    const res = state.results.find((r) => r.id === award.drawResultId);
    if (res) res._award = true;
    const entry = state.entries.find((e) => e.id === award.entryId);
    if (entry) entry._awards = true;
    return award;
  });
  d.giveawayDrawResult.create = createResult;
  // Valeurs par défaut du schéma et relations du tirage.
  const createDraw = d.giveawayDraw.create;
  d.giveawayDraw.create = jest.fn(async (args: any) => createDraw({ data: { status: 'OFFICIAL', ...args.data } }));
  const createAwardWithDefault = d.giveawayAward.create;
  d.giveawayAward.create = jest.fn(async (args: any) => createAwardWithDefault({ data: { status: 'PENDING_CONFIRMATION', ...args.data } }));
  const findDraw = d.giveawayDraw.findUnique;
  d.giveawayDraw.findUnique = jest.fn(async (args: any) => {
    const draw = await findDraw(args);
    if (!draw || !args.include) return draw;
    const category = state.giveaways.flatMap((g: any) => g._categories).find((c: any) => c.id === draw.categoryId);
    const results = state.results
      .filter((r: any) => r.drawId === draw.id)
      .sort((a: any, b: any) => a.rank - b.rank)
      .map((r: any) => ({ ...r, entry: state.entries.find((e: any) => e.id === r.entryId), award: state.awards.find((a: any) => a.drawResultId === r.id) ?? null }));
    return { ...draw, category, results };
  });
  const findResult = d.giveawayDrawResult.findFirst;
  d.giveawayDrawResult.findFirst = jest.fn(async (args: any) => {
    const r = await findResult(args);
    return r ? { ...r, entry: state.entries.find((e: any) => e.id === r.entryId) } : null;
  });
  // Relation participation → catégorie (include: { category: true }).
  const createEntry = d.giveawayEntry.create;
  d.giveawayEntry.create = jest.fn(async (args: any) => {
    const row = await createEntry(args);
    Object.defineProperty(row, 'category', {
      enumerable: false,
      get: () => state.giveaways.flatMap((g: any) => g._categories).find((c: any) => c.id === row.categoryId),
    });
    return row;
  });
  const findUnique = d.giveaway.findUnique;
  d.giveaway.findUnique = jest.fn(async (args: any) => {
    const g = await findUnique(args);
    return g ? { ...g, categories: g._categories } : null;
  });
  return d;
}

/* ---------- Données ---------- */

const OPEN = new Date('2026-12-10T12:00:00Z');
const AFTER_CLOSE = new Date('2027-01-08T00:30:00Z');
const AFTER_DRAW = new Date('2027-01-08T09:30:00Z');

function seedGiveaway(over: Record<string, unknown> = {}): any {
  const def = inkera20262027Definition();
  const gid = id('g');
  const categories = def.categories.map((c, i) => ({
    id: `cat-${c.key}`,
    giveawayId: gid,
    key: c.key,
    label: c.label,
    description: c.description,
    criteria: c.criteria,
    winnersCount: c.winnersCount,
    alternatesCount: c.alternatesCount,
    sortOrder: i,
    prizes: c.prizes.map((p, j) => ({ id: `prize-${c.key}-${j}`, giveawayId: gid, categoryId: `cat-${c.key}`, createdAt: new Date(), ...p })),
  }));
  const g = {
    id: gid,
    slug: def.slug,
    title: def.title,
    description: def.description,
    status: 'SCHEDULED',
    opensAt: def.opensAt,
    closesAt: def.closesAt,
    drawAt: def.drawAt,
    timezone: 'Europe/Paris',
    publishedAt: new Date('2026-11-20'),
    archivedAt: null,
    frozenAt: null,
    resultsPublishedAt: null,
    rulesVersion: 1,
    rulesHash: 'hash',
    rulesUrl: null,
    rulesContent: 'Règlement',
    rulesApprovedAt: new Date('2026-11-19'),
    config: { acceptanceDays: 14, retentionDays: 365 },
    _categories: categories,
    ...over,
  };
  db.state.giveaways.push(g);
  return g;
}

function setup(users: Record<string, { user: EligibilityUser; works: string[] }>) {
  db = createDb();
  const fakePrisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => users[where.id]?.user ?? null) },
    portfolio: { findMany: jest.fn(async ({ where }: any) => (users[where.userId]?.works ?? []).map((imageUrl) => ({ imageUrl }))) },
  };
  const eligibility = new GiveawayEligibilityService(fakePrisma);
  const mailer = { sendOnce: jest.fn().mockResolvedValue('SENT'), adminEmail: () => 'admin@test.dev' };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const grants = { preview: jest.fn(), apply: jest.fn(), cancel: jest.fn() };
  const service = new GiveawaysService(db, eligibility, mailer as never, audit as never);
  const admin = new GiveawaysAdminService(db, eligibility, mailer as never, audit as never, grants as never);
  return { service, admin, mailer, audit, grants, users };
}

const works = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `https://utfs.io/f/${prefix}${i}.jpg`);
const artist = (uid: string, over: Partial<EligibilityUser> = {}) => ({
  user: makeUser({ id: uid, email: `${uid}@test.dev`, phone: `06${String(uid.length * 1111111 + uid.charCodeAt(uid.length - 1)).padStart(8, '0')}`, salonName: `Studio ${uid}`, ...over }),
  works: works(5, uid),
});

/* ---------- Participation ---------- */

describe('Participation', () => {
  it('eligible independent artist enters once; replay and concurrent requests are idempotent', async () => {
    const { service, mailer } = setup({ a: artist('a') });
    const g = seedGiveaway();
    const first = await service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN);
    expect(first).toMatchObject({ created: true, entry: { status: 'VALID', category: { key: 'independent' }, rulesVersion: 1 } });
    expect(db.state.entries[0]).toMatchObject({ acceptedRulesAt: OPEN, rulesHash: 'hash', participantHash: expect.any(String) });
    const replay = await service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN);
    expect(replay.created).toBe(false);
    expect(db.state.entries).toHaveLength(1);
    expect(mailer.sendOnce).toHaveBeenCalledTimes(1);
    expect(mailer.sendOnce.mock.calls[0][0]).toBe(`entry:${db.state.entries[0].id}:confirmation`);
  });

  it('concurrent first requests: unique constraint wins, the loser gets the existing entry', async () => {
    const { service } = setup({ a: artist('a') });
    const g = seedGiveaway();
    const results = await Promise.all([1, 2, 3].map(() => service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN)));
    expect(db.state.entries).toHaveLength(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('rules must be accepted explicitly and in their current version', async () => {
    const { service } = setup({ a: artist('a') });
    const g = seedGiveaway({ rulesVersion: 2 });
    await expect(service.enter(g.slug, 'a', { acceptRules: false, rulesVersion: 2 }, OPEN)).rejects.toThrow(/accepter le règlement/);
    await expect(service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN)).rejects.toThrow(ConflictException);
    expect(db.state.entries).toHaveLength(0);
  });

  it('incomplete profile is refused with the missing fields', async () => {
    const { service } = setup({ a: { user: makeUser({ id: 'a', profileImage: null }), works: works(3) } });
    const g = seedGiveaway();
    const error = await service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN).catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse().eligibility.missingFields).toEqual(expect.arrayContaining(['PROFILE_PHOTO', 'PORTFOLIO_IMAGES']));
  });

  it('old accounts and paying subscribers are eligible (plan and signup date are not criteria)', async () => {
    const { service } = setup({ old: artist('old'), salon: artist('salon', { role: 'user_salon', salonPhotos: ['s1', 's2'] }) });
    const g = seedGiveaway();
    expect((await service.enter(g.slug, 'old', { acceptRules: true, rulesVersion: 1 }, OPEN)).entry.status).toBe('VALID');
    const salon = await service.enter(g.slug, 'salon', { acceptRules: true, rulesVersion: 1 }, OPEN);
    expect(salon.entry.category.key).toBe('salon');
  });

  it('admin and client accounts match no category', async () => {
    const { service } = setup({ adm: artist('adm', { role: 'admin' }), cli: artist('cli', { role: 'client' }) });
    const g = seedGiveaway();
    for (const uid of ['adm', 'cli']) {
      const error = await service.enter(g.slug, uid, { acceptRules: true, rulesVersion: 1 }, OPEN).catch((e) => e);
      expect(error.getResponse().eligibility.reason).toBe('NO_MATCHING_CATEGORY');
    }
  });

  it('entries are refused before opening, after closing, while draft or with unapproved rules', async () => {
    const { service } = setup({ a: artist('a') });
    const g = seedGiveaway();
    await expect(service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, new Date('2026-11-30T22:59:59Z'))).rejects.toThrow(ForbiddenException);
    await expect(service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, new Date('2027-01-07T23:00:00Z'))).rejects.toThrow(ForbiddenException);
    g.rulesApprovedAt = null;
    await expect(service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN)).rejects.toThrow(ForbiddenException);
    g.status = 'DRAFT';
    g.publishedAt = null;
    await expect(service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN)).rejects.toThrow(/introuvable/);
  });

  it('second account sharing a phone is flagged for manual review, never merged or rejected automatically', async () => {
    const { service, audit } = setup({ a: artist('a', { phone: '0611111111' }), b: artist('b', { phone: '+33 6 11 11 11 11' }) });
    const g = seedGiveaway();
    await service.enter(g.slug, 'a', { acceptRules: true, rulesVersion: 1 }, OPEN);
    const second = await service.enter(g.slug, 'b', { acceptRules: true, rulesVersion: 1 }, OPEN);
    expect(second.entry.status).toBe('UNDER_REVIEW');
    expect(db.state.entries[0].status).toBe('VALID');
    expect(db.state.entries[1].duplicateOfEntryIds).toEqual([db.state.entries[0].id]);
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/0611111111|@test\.dev/);
  });
});

/* ---------- Clôture, tirage, lots ---------- */

async function enterMany(service: GiveawaysService, slug: string, uids: string[]) {
  for (const uid of uids) await service.enter(slug, uid, { acceptRules: true, rulesVersion: 1 }, OPEN);
}

describe('Freeze and draw', () => {
  const pool = () => Object.fromEntries([
    ...['a', 'b', 'c', 'd', 'e', 'f', 'h'].map((u) => [u, artist(u)]),
    ['s1', artist('s1', { role: 'user_salon' })],
  ]);

  it('full flow: freeze re-checks eligibility, one official draw per category, distinct winners and alternates', async () => {
    const { service, admin, users } = setup(pool());
    const g = seedGiveaway();
    await enterMany(service, g.slug, ['a', 'b', 'c', 'd', 'e', 'f', 'h', 's1']);
    users.h.works = works(2); // profil appauvri après l'inscription

    await expect(admin.freeze(g.id, 'wrong', 'admin', AFTER_CLOSE)).rejects.toThrow(/Confirmation/);
    await expect(admin.freeze(g.id, g.slug, 'admin', OPEN)).rejects.toThrow(/pas terminée/);
    const frozen = await admin.freeze(g.id, g.slug, 'admin', AFTER_CLOSE);
    expect(frozen.categories).toEqual([{ key: 'independent', eligible: 6 }, { key: 'salon', eligible: 1 }]);
    expect(db.state.entries.find((e: any) => e.userId === 'h')).toMatchObject({ status: 'INVALID', invalidReason: 'INELIGIBLE_AT_CLOSE' });

    await expect(admin.draw(g.id, 'cat-independent', g.slug, 'admin', AFTER_CLOSE)).rejects.toThrow(ForbiddenException);
    const draw = await admin.draw(g.id, 'cat-independent', g.slug, 'admin', AFTER_DRAW);
    const winners = draw.results.filter((r: any) => r.role === 'WINNER');
    const alternates = draw.results.filter((r: any) => r.role === 'ALTERNATE');
    expect(winners).toHaveLength(3);
    expect(alternates).toHaveLength(3);
    expect(new Set(draw.results.map((r: any) => r.entryId)).size).toBe(6);
    expect(draw.results.map((r: any) => r.entryId)).not.toContain(db.state.entries.find((e: any) => e.userId === 'h').id);
    expect(db.state.awards.filter((a: any) => a.categoryId === 'cat-independent')).toHaveLength(3);
    expect(db.state.awards.every((a: any) => a.status === undefined || a.status === 'PENDING_CONFIRMATION')).toBe(true);

    await expect(admin.draw(g.id, 'cat-independent', g.slug, 'admin', AFTER_DRAW)).rejects.toThrow(/existe déjà/);
    await admin.draw(g.id, 'cat-salon', g.slug, 'admin', AFTER_DRAW);
    expect(g.status).toBe('DRAWN');
    // Le snapshot figé n'est pas renvoyé par l'API admin.
    expect(draw).not.toHaveProperty('snapshot');
  });

  it('freeze is blocked while entries await review, and duplicates appearing after entry are flagged', async () => {
    const { service, admin, users } = setup(pool());
    const g = seedGiveaway();
    await enterMany(service, g.slug, ['a', 'b']);
    users.b.user.phone = users.a.user.phone; // modifié après l'inscription
    await expect(admin.freeze(g.id, g.slug, 'admin', AFTER_CLOSE)).rejects.toThrow(/partagent des coordonnées/);
    expect(db.state.entries.every((e: any) => e.status === 'PENDING_REVIEW')).toBe(true);
    await expect(admin.freeze(g.id, g.slug, 'admin', AFTER_CLOSE)).rejects.toThrow(/à examiner/);
    await admin.reviewEntry(g.id, db.state.entries[1].id, 'INVALID', 'Même personne', 'admin', AFTER_CLOSE);
    await admin.reviewEntry(g.id, db.state.entries[0].id, 'VALID', 'Retenu', 'admin', AFTER_CLOSE);
    await expect(admin.freeze(g.id, g.slug, 'admin', AFTER_CLOSE)).resolves.toBeDefined();
    expect(db.state.entries[1]).toMatchObject({ status: 'INVALID', invalidReason: 'RULES_VIOLATION' });
  });

  it('not enough candidates: draws what exists and reports the shortfall', async () => {
    const { service, admin } = setup(pool());
    const g = seedGiveaway();
    await enterMany(service, g.slug, ['a', 'b']);
    await admin.freeze(g.id, g.slug, 'admin', AFTER_CLOSE);
    const draw = await admin.draw(g.id, 'cat-independent', g.slug, 'admin', AFTER_DRAW);
    expect(draw.results).toHaveLength(2);
    expect(draw.results.every((r: any) => r.role === 'WINNER')).toBe(true);
    const empty = await admin.draw(g.id, 'cat-salon', g.slug, 'admin', AFTER_DRAW);
    expect(empty.results).toHaveLength(0);
  });

  it('declined prize goes to the next alternate in draw order; void requires the exceptional procedure', async () => {
    const { service, admin } = setup(pool());
    const g = seedGiveaway();
    await enterMany(service, g.slug, ['a', 'b', 'c', 'd', 'e', 'f']);
    await admin.freeze(g.id, g.slug, 'admin', AFTER_CLOSE);
    const draw = await admin.draw(g.id, 'cat-independent', g.slug, 'admin', AFTER_DRAW);
    await expect(admin.promoteAlternate(draw.id, 'admin')).rejects.toThrow(/Aucun lot libéré/);
    const award = db.state.awards[0];
    award.status = 'DECLINED';
    jest.spyOn(admin as any, 'getAward').mockResolvedValue({});
    await admin.promoteAlternate(draw.id, 'admin');
    const promoted = db.state.awards[db.state.awards.length - 1];
    const firstAlternate = draw.results.find((r: any) => r.role === 'ALTERNATE');
    expect(promoted).toMatchObject({ entryId: firstAlternate!.entryId, prizeId: award.prizeId });

    await expect(admin.voidDraw(g.id, draw.id, 'Erreur matérielle constatée par huissier lors du tirage', g.slug, 'admin', AFTER_DRAW)).rejects.toThrow(/Confirmation/);
    await admin.voidDraw(g.id, draw.id, 'Erreur matérielle constatée par huissier lors du tirage', `ANNULER ${g.slug}`, 'admin', AFTER_DRAW);
    expect(db.state.draws[0]).toMatchObject({ status: 'VOIDED', officialKey: null });
    const redraw = await admin.draw(g.id, 'cat-independent', g.slug, 'admin', AFTER_DRAW);
    expect(db.state.draws.find((d: any) => d.id === redraw.id).supersedesId).toBe(draw.id);
  });
});

describe('Admin safeguards', () => {
  it('substantial fields are locked once the giveaway is open', async () => {
    const { admin } = setup({});
    const g = seedGiveaway();
    jest.useFakeTimers().setSystemTime(OPEN);
    await expect(admin.update(g.id, { closesAt: '2027-02-01T00:00:00+01:00' }, 'admin', OPEN)).rejects.toThrow(/avenant/);
    jest.useRealTimers();
  });

  it('CSV export neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+33612')).toBe("'+33612");
    expect(csvCell('Studio; Nord')).toBe('"Studio; Nord"');
  });

  it('admin guard re-reads the role in the database', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'user_salon' }) } };
    const guard = new GiveawayAdminGuard(prisma);
    const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
    await expect(guard.canActivate(ctx({ userId: 'x', role: 'admin' }))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx({ userId: 'x', role: 'user_salon' }))).rejects.toThrow(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    await expect(guard.canActivate(ctx({ userId: 'x', role: 'admin' }))).resolves.toBe(true);
  });
});
