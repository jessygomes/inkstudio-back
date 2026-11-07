import { UnauthorizedException } from '@nestjs/common';
import { REFRESH_REUSE_GRACE_MS, RefreshTokenService, hashRefreshToken } from './refresh-token.service';

type Row = {
  id: string; userId: string; familyId: string; tokenHash: string;
  expiresAt: Date; revokedAt: Date | null; rotatedAt: Date | null; createdAt: Date; userAgent: string | null;
};

// Table RefreshToken en mémoire : juste assez de Prisma pour exercer la logique de rotation.
function fakePrisma() {
  const rows: Row[] = [];
  let n = 0;
  const match = (r: Row, where: Partial<Row>) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v || (v === null && (r as Record<string, unknown>)[k] === null));
  const refreshToken = {
    create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
      const row: Row = { id: `rt${++n}`, revokedAt: null, rotatedAt: null, createdAt: new Date(), userAgent: null, ...data } as Row;
      rows.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: { where: Partial<Row> }) => rows.find((r) => match(r, where)) ?? null),
    updateMany: jest.fn(async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
  return { rows, prisma: { refreshToken } as never };
}

describe('RefreshTokenService', () => {
  it("n'enregistre que l'empreinte du jeton, jamais le jeton", async () => {
    const { rows, prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    const { refreshToken } = await svc.issue('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashRefreshToken(refreshToken));
    expect(JSON.stringify(rows[0])).not.toContain(refreshToken);
  });

  it('remplace le jeton à chaque rotation, dans la même famille', async () => {
    const { rows, prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    const first = await svc.issue('u1');
    const second = await svc.rotate(first.refreshToken);
    expect(second.userId).toBe('u1');
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(rows).toHaveLength(2);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[1].revokedAt).toBeNull();
    expect(rows[1].familyId).toBe(rows[0].familyId);
  });

  it('refuse un jeton inconnu ou expiré', async () => {
    const { rows, prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    await expect(svc.rotate('x'.repeat(40))).rejects.toBeInstanceOf(UnauthorizedException);
    const t = await svc.issue('u1');
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.rotate(t.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepte une réutilisation immédiate (requêtes simultanées) sans révoquer la famille', async () => {
    const { rows, prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    const first = await svc.issue('u1');
    await svc.rotate(first.refreshToken);
    // Le même jeton revient aussitôt : accepté, la famille continue (deux jetons valides, l'un des deux sera simplement délaissé).
    const again = await svc.rotate(first.refreshToken);
    expect(again.userId).toBe('u1');
    expect(rows.filter((r) => r.revokedAt === null).length).toBe(2);
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
  });

  it("révoque toute la famille quand un jeton remplacé revient après la fenêtre de grâce (vol probable)", async () => {
    const { rows, prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    const first = await svc.issue('u1');
    await svc.rotate(first.refreshToken);
    const old = new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000);
    rows[0].revokedAt = old;
    rows[0].rotatedAt = old;
    await expect(svc.rotate(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('une session révoquée à la main ne profite pas de la fenêtre de grâce', async () => {
    const { prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    const a = await svc.issue('u1');
    const next = await svc.rotate(a.refreshToken); // a vient d'être remplacé (grâce possible)
    await svc.revokeByToken(next.refreshToken); // déconnexion : toute la famille tombe
    await expect(svc.rotate(a.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.rotate(next.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('révoque la famille à la déconnexion et toutes les sessions sur demande', async () => {
    const { rows, prisma } = fakePrisma();
    const svc = new RefreshTokenService(prisma);
    const a = await svc.issue('u1');
    const b = await svc.issue('u1');
    await svc.revokeByToken(a.refreshToken);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[1].revokedAt).toBeNull();
    await svc.revokeAllForUser('u1');
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(svc.rotate(b.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
