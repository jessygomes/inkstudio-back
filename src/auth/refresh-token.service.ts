import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from 'src/database/prisma.service';

export type IssuedRefreshToken = { refreshToken: string; refreshExpiresAt: Date };

/** Durée de vie d'un jeton de rafraîchissement (jours), renouvelée à chaque rotation. */
export function refreshTokenDays(): number {
  const parsed = Number.parseInt(process.env.JWT_REFRESH_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

/**
 * Fenêtre pendant laquelle un jeton déjà remplacé est encore accepté : deux requêtes simultanées d'un même client
 * (onglets, requêtes parallèles) présentent le même jeton, ce n'est pas un vol. Passé ce délai, la réutilisation
 * d'un jeton remplacé révoque toute la famille.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

export const hashRefreshToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crée un jeton (nouvelle famille à la connexion, même famille à la rotation). Seule l'empreinte est enregistrée. */
  async issue(userId: string, opts: { familyId?: string; userAgent?: string } = {}): Promise<IssuedRefreshToken> {
    const raw = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + refreshTokenDays() * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: opts.familyId ?? randomUUID(),
        tokenHash: hashRefreshToken(raw),
        expiresAt,
        userAgent: opts.userAgent?.slice(0, 255) ?? null,
      },
    });
    return { refreshToken: raw, refreshExpiresAt: expiresAt };
  }

  /**
   * Remplace un jeton par un nouveau de la même famille. Refuse (401) un jeton inconnu ou expiré.
   * Un jeton remplacé depuis plus de REFRESH_REUSE_GRACE_MS qui revient est un signe de vol : toute la famille est révoquée (401).
   * Un jeton remplacé depuis moins que cela est accepté (requêtes simultanées) : la famille continue.
   */
  async rotate(raw: string, userAgent?: string): Promise<IssuedRefreshToken & { userId: string }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(raw) } });
    if (!row) throw new UnauthorizedException('Session expirée.');
    const now = new Date();
    if (row.expiresAt <= now) throw new UnauthorizedException('Session expirée.');
    // Jeton remplacé par rotation il y a un instant (et non révoqué à la main depuis) : requête simultanée d'un même client.
    const justRotated = (r: { revokedAt: Date | null; rotatedAt: Date | null }) =>
      !!r.revokedAt && !!r.rotatedAt && now.getTime() - r.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
    if (row.revokedAt) {
      if (!justRotated(row)) {
        // Révoqué, ou remplacé il y a longtemps : réutilisation suspecte, toute la famille est révoquée.
        await this.revokeFamily(row.familyId);
        throw new UnauthorizedException('Session expirée.');
      }
      // Dans la fenêtre de grâce : on continue la famille avec un nouveau jeton.
    } else {
      // Remplacement conditionnel : si deux requêtes arrivent ensemble, une seule le fait ; l'autre est acceptée comme ci-dessus.
      const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now, rotatedAt: now } });
      if (claimed.count === 0) {
        const fresh = await this.prisma.refreshToken.findUnique({ where: { id: row.id } });
        if (!fresh || !justRotated(fresh)) throw new UnauthorizedException('Session expirée.');
      }
    }
    const next = await this.issue(row.userId, { familyId: row.familyId, userAgent });
    return { ...next, userId: row.userId };
  }

  /** Déconnexion d'un appareil : révoque toute la famille du jeton présenté (silencieux si le jeton est inconnu). */
  async revokeByToken(raw: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(raw) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    // Tous les jetons de la famille, y compris ceux déjà remplacés : rotatedAt est effacé, plus aucun ne profite de la fenêtre de grâce.
    await this.prisma.refreshToken.updateMany({ where: { familyId }, data: { revokedAt: new Date(), rotatedAt: null } });
  }

  /** Toutes les sessions de l'utilisateur (changement ou réinitialisation du mot de passe, « déconnecter tous les appareils »). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revokedAt: new Date(), rotatedAt: null } });
  }
}
