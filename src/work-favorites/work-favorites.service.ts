import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { pseudoOf } from 'src/messaging/client-identity';

const PRO_ROLES = ['user', 'user_salon', 'user_tatoueur'];

export type FavoritedWorkKind = 'portfolio' | 'flash';

/**
 * Favoris de réalisations et de flashs posés par les clients (Inkera People).
 * Le professionnel concerné est prévenu avec le seul pseudo du client et peut lui écrire
 * (voir ClientAccessService : il ne voit ses informations qu'après son accord).
 */
@Injectable()
export class WorkFavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Prévient le propriétaire de la réalisation ou du flash. Ne lève jamais d'erreur. */
  notifyFavorited(clientId: string, kind: FavoritedWorkKind, item: { id: string; userId: string; title?: string | null }) {
    if (!this.notifications) return;
    void (async () => {
      try {
        if (item.userId === clientId) return;
        const [client, blocked] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: clientId },
            select: { role: true, nickname: true, clientProfile: { select: { pseudo: true } } },
          }),
          this.prisma.professionalBlock.findUnique({
            where: { clientUserId_professionalId: { clientUserId: clientId, professionalId: item.userId } },
          }),
        ]);
        if (!client || client.role !== 'client' || blocked) return;
        const pseudo = pseudoOf(client) || 'Un client Inkera';
        const what = kind === 'flash' ? "l'un de vos flashs" : "l'une de vos réalisations";
        const title = item.title?.trim();
        await this.notifications!.notify({
          userId: item.userId,
          type: 'favorite.work_added',
          title: `${pseudo} a mis en favori ${what}`,
          body: title
            ? `« ${title} ». Vous pouvez lui écrire depuis vos favoris reçus.`
            : 'Vous pouvez lui écrire depuis vos favoris reçus.',
          data: { clientUserId: clientId, kind, ...(kind === 'flash' ? { flashId: item.id } : { portfolioId: item.id }) },
          // Retirer puis remettre le même favori ne renvoie pas de notification.
          dedupeKey: `favorite:${kind}:${item.id}:${clientId}`,
        });
      } catch {
        // une notification ratée ne bloque jamais le favori
      }
    })();
  }

  /** Client : ajoute ou retire un flash de ses favoris. */
  async toggleFlash(clientId: string, role: string | undefined, flashId: string) {
    if (role !== 'client') throw new ForbiddenException('Accès réservé aux clients.');
    const flash = await this.prisma.flash.findUnique({
      where: { id: flashId },
      select: { id: true, userId: true, title: true, user: { select: { publicVisibility: true } } },
    });
    if (!flash || flash.user.publicVisibility === 'HIDDEN') throw new NotFoundException('Flash introuvable.');
    const existing = await this.prisma.favoriteFlash.findUnique({
      where: { clientId_flashId: { clientId, flashId } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.favoriteFlash.delete({ where: { id: existing.id } });
      return { error: false, favorite: false, message: 'Flash retiré des favoris.' };
    }
    await this.prisma.favoriteFlash.create({ data: { clientId, flashId } });
    this.notifyFavorited(clientId, 'flash', flash);
    return { error: false, favorite: true, message: 'Flash ajouté aux favoris.' };
  }

  /** Client : flashs en favori (profils visibles seulement). */
  async listFlashes(clientId: string) {
    const favorites = await this.prisma.favoriteFlash.findMany({
      where: { clientId, flash: { user: { publicVisibility: { not: 'HIDDEN' } } } },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        flash: {
          select: {
            id: true, title: true, description: true, imageUrl: true, price: true, dimension: true,
            appointmentDurationMinutes: true, isAvailable: true, style: true,
            user: { select: { id: true, salonName: true, firstName: true, lastName: true, nickname: true, image: true, profileImage: true, city: true, postalCode: true, role: true } },
            tatoueur: { select: { id: true, name: true, img: true } },
          },
        },
      },
    });
    return {
      error: false,
      favoriteFlashes: favorites.map((f) => ({ ...f.flash, favoritedAt: f.createdAt })),
    };
  }

  /** Client : identifiants de ses flashs en favori (pour afficher les cœurs). */
  async flashIds(clientId: string) {
    const rows = await this.prisma.favoriteFlash.findMany({ where: { clientId }, select: { flashId: true } });
    return { error: false, flashIds: rows.map((r) => r.flashId) };
  }

  /**
   * Professionnel : favoris reçus sur ses réalisations et ses flashs, du plus récent au plus ancien.
   * Le client n'apparaît que sous son pseudo ; `conversation` indique si une conversation existe déjà.
   */
  async received(professionalId: string, role: string | undefined, page = 1, limit = 20) {
    if (!role || !PRO_ROLES.includes(role)) throw new ForbiddenException('Compte professionnel requis.');
    const safePage = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(limit) || 20));
    const window = safePage * pageSize;
    const clientSelect = { id: true, nickname: true, clientProfile: { select: { pseudo: true } } } as const;
    const [portfolios, flashes, portfolioTotal, flashTotal] = await Promise.all([
      this.prisma.favoritePortfolio.findMany({
        where: { portfolio: { userId: professionalId }, client: { role: 'client' } },
        orderBy: { createdAt: 'desc' },
        take: window,
        select: {
          id: true, createdAt: true,
          client: { select: clientSelect },
          portfolio: { select: { id: true, title: true, imageUrl: true, tatoueur: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.favoriteFlash.findMany({
        where: { flash: { userId: professionalId }, client: { role: 'client' } },
        orderBy: { createdAt: 'desc' },
        take: window,
        select: {
          id: true, createdAt: true,
          client: { select: clientSelect },
          flash: { select: { id: true, title: true, imageUrl: true, price: true, tatoueur: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.favoritePortfolio.count({ where: { portfolio: { userId: professionalId }, client: { role: 'client' } } }),
      this.prisma.favoriteFlash.count({ where: { flash: { userId: professionalId }, client: { role: 'client' } } }),
    ]);

    const merged = [
      ...portfolios.map((f) => ({
        id: `portfolio:${f.id}`,
        kind: 'portfolio' as const,
        createdAt: f.createdAt,
        clientUserId: f.client.id,
        clientPseudo: pseudoOf(f.client) || 'Client Inkera',
        work: { id: f.portfolio.id, title: f.portfolio.title, imageUrl: f.portfolio.imageUrl, price: null as number | null, tatoueurName: f.portfolio.tatoueur?.name ?? null },
      })),
      ...flashes.map((f) => ({
        id: `flash:${f.id}`,
        kind: 'flash' as const,
        createdAt: f.createdAt,
        clientUserId: f.client.id,
        clientPseudo: pseudoOf(f.client) || 'Client Inkera',
        work: { id: f.flash.id, title: f.flash.title, imageUrl: f.flash.imageUrl, price: f.flash.price, tatoueurName: f.flash.tatoueur?.name ?? null },
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice((safePage - 1) * pageSize, safePage * pageSize);

    const clientIds = [...new Set(merged.map((m) => m.clientUserId))];
    const [conversations, blocks] = await Promise.all([
      clientIds.length
        ? this.prisma.conversation.findMany({
            where: { salonId: professionalId, clientUserId: { in: clientIds } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, clientUserId: true, clientAccess: true },
          })
        : Promise.resolve([]),
      clientIds.length
        ? this.prisma.professionalBlock.findMany({
            where: { professionalId, clientUserId: { in: clientIds } },
            select: { clientUserId: true },
          })
        : Promise.resolve([]),
    ]);
    const conversationByClient = new Map<string, { id: string; clientAccess: string | null }>();
    for (const c of conversations) if (!conversationByClient.has(c.clientUserId)) conversationByClient.set(c.clientUserId, c);
    const blocked = new Set(blocks.map((b) => b.clientUserId));

    const total = portfolioTotal + flashTotal;
    return {
      error: false,
      data: merged.map((m) => {
        const conversation = conversationByClient.get(m.clientUserId);
        return {
          ...m,
          canContact: !blocked.has(m.clientUserId),
          conversation: conversation ? { id: conversation.id, clientAccess: conversation.clientAccess } : null,
        };
      }),
      total,
      page: safePage,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
