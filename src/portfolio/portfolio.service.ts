import { publicDisplayName, withPublicName } from '../user/public-profile.utils';
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AddPhotoDto } from './dto/add-photo.dto';
import { AddPhotosBatchDto } from './dto/add-photos-batch.dto';
import { CacheService } from 'src/redis/cache.service';
import { PieceSize } from '@prisma/client';
import { findClosestStyle, levenshtein, styleKey, typoTolerance } from './style.utils';

export interface PortfolioFilters {
  style?: string;
  hashtag?: string;
  category?: string;
  pieceSize?: string;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private cacheService: CacheService
  ) {}

  private normalizeStyles(styleInput: unknown): string[] {
    return Array.isArray(styleInput)
      ? [
          ...new Set(
            styleInput
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean),
          ),
        ]
      : [];
  }

  private styleKey = styleKey;
  private levenshtein = levenshtein;
  private typoTolerance = typoTolerance;
  private findClosestStyle = findClosestStyle;

  // Associe chaque style saisi au style existant (même orthographe approchante) ou le crée, sans doublon
  private async resolveStyles(styleInput: unknown): Promise<string[]> {
    const requested = this.normalizeStyles(styleInput);
    if (requested.length === 0) return [];

    const known = await this.prisma.style.findMany({ select: { name: true, key: true } });
    const resolved = new Set<string>();

    for (const name of requested) {
      const key = this.styleKey(name);
      if (!key) continue;
      const match = this.findClosestStyle(key, known);
      if (match) {
        resolved.add(match.name);
        continue;
      }
      const created = await this.prisma.style.upsert({
        where: { key },
        update: {},
        create: { name, key },
        select: { name: true, key: true },
      });
      known.push(created);
      resolved.add(created.name);
    }

    return [...resolved];
  }

  //! LISTER LES STYLES (tous, ou seulement ceux présents dans le portfolio d'un user)
  async getStyles({ userId, tatoueurId }: { userId?: string; tatoueurId?: string } = {}) {
    if (!userId) {
      const styles = await this.prisma.style.findMany({ orderBy: { name: 'asc' }, select: { name: true } });
      return { error: false, styles: styles.map((s) => ({ name: s.name })) };
    }

    const { ownerWhere } = await this.resolveOwnerScope(userId, tatoueurId);
    const photos = await this.prisma.portfolio.findMany({
      where: ownerWhere,
      select: { style: true },
    });

    const counts = new Map<string, number>();
    for (const photo of photos) {
      for (const name of photo.style) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }

    const styles = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { error: false, styles };
  }

  //! SUGGESTIONS DE STYLES PENDANT LA SAISIE
  async suggestStyles(query?: string) {
    const raw = (query ?? '').trim();
    const key = this.styleKey(raw);
    const known = await this.prisma.style.findMany({ orderBy: { name: 'asc' }, select: { name: true, key: true } });

    if (!key) {
      return { error: false, suggestions: [], exactMatch: false, canCreate: false };
    }

    const tolerance = this.typoTolerance(key);
    const suggestions = known
      .filter(
        (s) =>
          s.key.includes(key) ||
          (tolerance > 0 && this.levenshtein(key, s.key.slice(0, key.length)) <= tolerance) ||
          (tolerance > 0 && this.levenshtein(key, s.key) <= tolerance),
      )
      .sort((a, b) => Number(b.key.startsWith(key)) - Number(a.key.startsWith(key)) || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((s) => s.name);

    const closest = this.findClosestStyle(key, known);
    return {
      error: false,
      suggestions,
      exactMatch: closest?.key === key,
      // Un style quasi identique à un existant sera fusionné avec lui à l'enregistrement
      canCreate: !closest,
      ...(closest && closest.key !== key ? { didYouMean: closest.name } : {}),
    };
  }

  private async resolveOwnerScope(userId: string, tatoueurId?: string) {
    const requestedUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        linkedTatoueurs: {
          select: {
            id: true,
            salonName: true, nickname: true, publicVisibility: true,
          },
        },
      },
    });

    const linkedTatoueurUserIds = requestedUser?.role === 'user_salon'
      ? (requestedUser.linkedTatoueurs ?? []).map((tatoueurUser) => tatoueurUser.id)
      : [];

    const linkedTatoueurNameByUserId = new Map(
      requestedUser?.role === 'user_salon'
        ? (requestedUser.linkedTatoueurs ?? []).map((tatoueurUser) => [
            tatoueurUser.id,
            publicDisplayName({ ...tatoueurUser, role: 'user_tatoueur' }),
          ])
        : [],
    );

    const normalizedTatoueurId = tatoueurId?.trim() || '';
    const linkedTatoueurFilterUserId = normalizedTatoueurId
      ? linkedTatoueurUserIds.find(
          (linkedUserId) =>
            linkedUserId === normalizedTatoueurId ||
            `linked_${linkedUserId}` === normalizedTatoueurId ||
            `linked_user_${linkedUserId}` === normalizedTatoueurId,
        )
      : undefined;

    const portfolioOwnerIds = Array.from(new Set([userId, ...linkedTatoueurUserIds]));

    const ownerWhere: Record<string, any> = {
      userId: linkedTatoueurFilterUserId
        ? linkedTatoueurFilterUserId
        : portfolioOwnerIds.length === 1
          ? portfolioOwnerIds[0]
          : { in: portfolioOwnerIds },
      ...(normalizedTatoueurId && !linkedTatoueurFilterUserId
        ? { tatoueurId: normalizedTatoueurId }
        : {}),
    };

    return { requestedUser, linkedTatoueurNameByUserId, ownerWhere };
  }

  private normalizeHashtags(input: unknown): string[] {
    return Array.isArray(input)
      ? [
          ...new Set(
            input
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim().replace(/^#+/, '').toLowerCase())
              .filter(Boolean),
          ),
        ]
      : [];
  }

  private normalizeIds(input: unknown): string[] {
    return Array.isArray(input)
      ? [...new Set(input.filter((i): i is string => typeof i === 'string' && i.trim() !== ''))]
      : [];
  }

  private async validateCategoryIds(ids: string[]) {
    if (ids.length === 0) return null;
    const count = await this.prisma.tattooCategory.count({
      where: { id: { in: ids }, isActive: true },
    });
    return count === ids.length
      ? null
      : { error: true, message: 'Une ou plusieurs catégories sont invalides.' };
  }

  //! LISTER LES CATEGORIES DE TATOUAGE
  async getCategories() {
    return this.prisma.tattooCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async validateTatoueurForSalon(tatoueurId: string, userId: string) {
    const tatoueur = await this.prisma.tatoueur.findFirst({
      where: {
        id: tatoueurId,
        userId,
      },
      select: { id: true },
    });

    if (!tatoueur) {
      return {
        error: true,
        message: 'Le tatoueur sélectionné est introuvable pour ce salon.',
      };
    }

    return null;
  }

   //! AJOUTER UNE PHOTO AU PORTFOLIO
  async addPhotoToPortfolio({portfolioBody, userId}: {portfolioBody: AddPhotoDto, userId: string}) {
    try {
      const { title, imageUrl, description, tatoueurId, pieceSize } = portfolioBody;
      let sourceUrl = imageUrl;
      if (portfolioBody.appointmentPhotoId) {
        const source = await this.prisma.appointmentPhoto.findUnique({
          where: { id: portfolioBody.appointmentPhotoId }, include: { appointment: true },
        });
        if (!source || (source.appointment.userId !== userId && source.appointment.performerUserId !== userId)) {
          return { error: true, message: 'Photo de rendez-vous introuvable ou non autorisée.' };
        }
        sourceUrl = source.url;
      }
      const normalizedStyles = await this.resolveStyles((portfolioBody as { style?: unknown }).style);
      const normalizedHashtags = this.normalizeHashtags(portfolioBody.hashtags);
      const categoryIds = this.normalizeIds(portfolioBody.categoryIds);

      // Vérifier si l'utilisateur existe
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return {
          error: true,
          message: 'Utilisateur non trouvé',
        };
      }

      if (tatoueurId) {
        const tatoueurValidation = await this.validateTatoueurForSalon(tatoueurId, userId);
        if (tatoueurValidation) {
          return tatoueurValidation;
        }
      }

      const categoryValidation = await this.validateCategoryIds(categoryIds);
      if (categoryValidation) {
        return categoryValidation;
      }

      // Ajouter la photo au portfolio
      const newPhoto = await this.prisma.portfolio.create({
        data: {
          userId,
          title,
          imageUrl: sourceUrl,
          appointmentPhotoId: portfolioBody.appointmentPhotoId,
          description,
          tatoueurId,
          style: normalizedStyles,
          pieceSize,
          hashtags: normalizedHashtags,
          categories: { connect: categoryIds.map((id) => ({ id })) },
        },
        include: { categories: true },
      });

      // Invalider le cache après ajout
      await this.cacheService.delPattern(`portfolio:photos:${userId}:*`);

      return {
        error: false,
        message: 'Photo ajoutée avec succès au portfolio',
        photo: newPhoto,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! AJOUTER PLUSIEURS PHOTOS AU PORTFOLIO (PAR LOT)
  async addPhotosBatchToPortfolio({ batchBody, userId }: { batchBody: AddPhotosBatchDto; userId: string }) {
    try {
      const { pieceSize, tatoueurId, photos } = batchBody;
      const styles = await this.resolveStyles(batchBody.style);
      const hashtags = this.normalizeHashtags(batchBody.hashtags);
      const categoryIds = this.normalizeIds(batchBody.categoryIds);

      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) {
        return { error: true, message: 'Utilisateur non trouvé' };
      }

      if (tatoueurId) {
        const tatoueurValidation = await this.validateTatoueurForSalon(tatoueurId, userId);
        if (tatoueurValidation) {
          return tatoueurValidation;
        }
      }

      const categoryValidation = await this.validateCategoryIds(categoryIds);
      if (categoryValidation) {
        return categoryValidation;
      }

      const createdPhotos = await this.prisma.$transaction(
        photos.map((photo, index) =>
          this.prisma.portfolio.create({
            data: {
              userId,
              title: photo.title?.trim() || `Photo ${index + 1}`,
              imageUrl: photo.imageUrl,
              description: photo.description,
              tatoueurId,
              style: styles,
              pieceSize,
              hashtags,
              categories: { connect: categoryIds.map((id) => ({ id })) },
            },
            include: { categories: true },
          }),
        ),
      );

      await this.cacheService.delPattern(`portfolio:photos:${userId}:*`);

      return {
        error: false,
        message: `${createdPhotos.length} photo(s) ajoutée(s) avec succès au portfolio`,
        photos: createdPhotos,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return { error: true, message: errorMessage };
    }
  }

  private parseCsv(value?: string, transform: (v: string) => string = (v) => v): string[] {
    return [...new Set((value ?? '').split(',').map((v) => transform(v.trim())).filter(Boolean))];
  }

  // Construit les filtres communs (style, hashtag, catégorie, taille) ; les valeurs multiples d'un même filtre se combinent en "OU"
  // (la photo est renvoyée si elle a au moins une des valeurs), les filtres différents se combinent en "ET"
  private buildPhotoFilters(filters: PortfolioFilters = {}) {
    const styles = this.parseCsv(filters.style, (v) => v.toUpperCase());
    const hashtags = this.parseCsv(filters.hashtag, (v) => v.replace(/^#+/, '').toLowerCase());
    const categories = this.parseCsv(filters.category, (v) => v.toLowerCase());
    const pieceSizes = this.parseCsv(filters.pieceSize, (v) => v.toUpperCase()).filter((v) =>
      (Object.values(PieceSize) as string[]).includes(v),
    ) as PieceSize[];

    const where: Record<string, any> = {
      ...(styles.length ? { style: { hasSome: styles } } : {}),
      ...(hashtags.length ? { hashtags: { hasSome: hashtags } } : {}),
      ...(categories.length ? { categories: { some: { slug: { in: categories } } } } : {}),
      ...(pieceSizes.length ? { pieceSize: { in: pieceSizes } } : {}),
    };
    const cacheKey = `s:${styles.join('|') || 'all'}:h:${hashtags.join('|') || 'all'}:c:${categories.join('|') || 'all'}:z:${pieceSizes.join('|') || 'all'}`;

    return { where, cacheKey };
  }

  //! VOIR TOUTES LES PHOTOS D'UN PORTFOLIO
  async getPortfolioPhotos(
    userId: string,
    tatoueurId?: string,
    page: number = 1,
    limit?: number,
    filters: PortfolioFilters = {},
    publicOnly = false,
  ) {
    try {
      const { where: filterWhere, cacheKey: filterKey } = this.buildPhotoFilters(filters);
      const normalizedLimit =
        typeof limit === 'number' && !Number.isNaN(limit) && limit > 0
          ? Math.floor(limit)
          : undefined;
      const currentPage = normalizedLimit
        ? Number.isNaN(page) || page < 1
          ? 1
          : page
        : 1;
      const skip = normalizedLimit ? (currentPage - 1) * normalizedLimit : 0;
      const cacheKey = `portfolio:photos:${userId}:${tatoueurId ?? 'all'}:page:${currentPage}:limit:${normalizedLimit ?? 'all'}:${filterKey}`;

      // 1. Vérifier dans Redis
      const cachedPhotos = await this.cacheService.get<{
        photos: {
          id: string;
          title: string;
          imageUrl: string;
          description: string;
          [key: string]: any;
        }[];
        pagination: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>(cacheKey);
      
      if (cachedPhotos && !publicOnly) {
        return cachedPhotos;
      }

      const { requestedUser, linkedTatoueurNameByUserId, ownerWhere } = await this.resolveOwnerScope(
        userId,
        tatoueurId,
      );

      const whereClause: Record<string, any> = {
        ...ownerWhere,
        ...(publicOnly ? { user: { publicVisibility: { not: 'HIDDEN' } } } : {}),
        ...filterWhere,
      };

      const total = await this.prisma.portfolio.count({
        where: whereClause,
      });

      // 2. Sinon, aller chercher en DB
      const photosFromDb = await this.prisma.portfolio.findMany({
        where: whereClause,
        include: { categories: { select: { id: true, slug: true, name: true } } },
        orderBy: { createdAt: 'desc' }, // Optionnel : trier par date de création
        ...(normalizedLimit
          ? {
              skip,
              take: normalizedLimit,
            }
          : {}),
      });

      const photos = photosFromDb.map((photo) => {
        if (requestedUser?.role !== 'user_salon') {
          return photo;
        }

        const linkedTatoueurName = linkedTatoueurNameByUserId.get(photo.userId);
        if (!linkedTatoueurName || photo.tatoueurId) {
          return photo;
        }

        return {
          ...photo,
          tatoueur: {
            id: `linked_user_${photo.userId}`,
            name: linkedTatoueurName,
            isLinkedUser: true,
            linkedUserId: photo.userId,
          },
        };
      });

      const pageSize = normalizedLimit ?? total;
      const totalPages = normalizedLimit ? Math.max(1, Math.ceil(total / normalizedLimit)) : 1;
      const response = {
        photos,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages,
          hasNextPage: normalizedLimit ? currentPage < totalPages : false,
          hasPreviousPage: normalizedLimit ? currentPage > 1 : false,
        },
      };

      // 3. Mettre en cache (TTL 15 minutes pour les photos portfolio)
      if (!publicOnly) await this.cacheService.set(cacheKey, response, 900);

      return response;
    } catch (error) {
      throw new Error('Erreur lors de la récupération des photos du portfolio : ' + error);
    }
  }

  //! VOIR TOUTES LES IMAGES D'INSPIRATION DES SALONS
  async getInspirationPortfolioPhotos({
    page = 1,
    limit = 12,
    city,
    style,
    hashtag,
    category,
    pieceSize,
  }: {
    page?: number;
    limit?: number;
    city?: string;
    style?: string;
    hashtag?: string;
    category?: string;
    pieceSize?: string;
  }) {
    try {
      const pageSize = Math.min(50, Math.max(1, Number(limit) || 12));
      const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;
      const skip = (currentPage - 1) * pageSize;
      const normalizedCity = city?.trim() || '';
      const { where: filterWhere, cacheKey: filterKey } = this.buildPhotoFilters({
        style,
        hashtag,
        category,
        pieceSize,
      });
      const cacheKey = `portfolio:inspirations:page:${currentPage}:limit:${pageSize}:city:${normalizedCity || 'all'}:${filterKey}`;

      // Visibility must be enforced even when Redis invalidation is unavailable.
      const whereClause: Record<string, any> = {
        user: {
          isInspirationSalon: true,
          publicVisibility: { not: 'HIDDEN' },
          ...(normalizedCity
            ? {
                city: {
                  contains: normalizedCity,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        },
        ...filterWhere,
      };

      const total = await this.prisma.portfolio.count({
        where: whereClause,
      });

      const photos = await this.prisma.portfolio.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          imageUrl: true,
          style: true,
          pieceSize: true,
          categories: { select: { id: true, slug: true, name: true } },
          hashtags: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              salonName: true, nickname: true, publicVisibility: true,
              image: true,
              city: true,
              postalCode: true,
              instagram: true,
              isInspirationSalon: true,
              saasPlan: true,
              role: true,
              profileImage: true,
              firstName: true,
              lastName: true,
              salon: {
                select: {
                  id: true,
                  salonName: true, nickname: true, publicVisibility: true,
                  image: true,
                  profileImage: true,
                  city: true,
                  postalCode: true,
                  instagram: true,
                  saasPlan: true,
                },
              },
            },
          },
          tatoueur: {
            select: {
              id: true,
              name: true,
              img: true,
              description: true,
              instagram: true,
            },
          },
        },
      });

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const response = {
        photos: photos.map((photo) => photo.user ? ({
          ...photo,
          user: { ...withPublicName(photo.user), salon: photo.user.salon?.publicVisibility === 'HIDDEN' ? null : photo.user.salon },
        }) : photo),
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };

      await this.cacheService.set(cacheKey, response, 900);

      return response;
    } catch (error) {
      throw new Error('Erreur lors de la récupération des images d\'inspiration du portfolio : ' + error);
    }
  }

  //! MODIFIER UNE PHOTO DU PORTFOLIO
  async updatePortfolioPhoto(id: string, updateData: Partial<AddPhotoDto>, userId: string) {
    try {
      // Vérifier si la photo existe
      const existingPhoto = await this.prisma.portfolio.findUnique({
        where: { id },
      });

      if (!existingPhoto) {
        return {
          error: true,
          message: 'Photo non trouvée',
        };
      }

      if (existingPhoto.userId !== userId) {
        return {
          error: true,
          message: 'Non autorisé à modifier cette photo.',
        };
      }

      if (updateData.appointmentPhotoId !== undefined && updateData.appointmentPhotoId !== existingPhoto.appointmentPhotoId) {
        return { error: true, message: 'La photo source du rendez-vous ne peut pas être changée depuis le portfolio.' };
      }

      if (updateData.tatoueurId) {
        const tatoueurValidation = await this.validateTatoueurForSalon(updateData.tatoueurId, userId);
        if (tatoueurValidation) {
          return tatoueurValidation;
        }
      }

      const { categoryIds: rawCategoryIds, ...rest } = updateData;
      let categoriesUpdate: { categories: { set: { id: string }[] } } | object = {};
      if (rawCategoryIds !== undefined) {
        const categoryIds = this.normalizeIds(rawCategoryIds);
        const categoryValidation = await this.validateCategoryIds(categoryIds);
        if (categoryValidation) {
          return categoryValidation;
        }
        categoriesUpdate = { categories: { set: categoryIds.map((cid) => ({ id: cid })) } };
      }

      const dataToUpdate = {
        ...rest,
        ...(updateData.style !== undefined
          ? { style: await this.resolveStyles((updateData as { style?: unknown }).style) }
          : {}),
        ...(updateData.hashtags !== undefined
          ? { hashtags: this.normalizeHashtags(updateData.hashtags) }
          : {}),
        ...categoriesUpdate,
      };

      // Mettre à jour la photo
      const updatedPhoto = await this.prisma.portfolio.update({
        where: { id },
        data: dataToUpdate,
        include: { categories: true },
      });

      // Invalider le cache après mise à jour
      await this.cacheService.delPattern(`portfolio:photos:${existingPhoto.userId}:*`);

      return {
        error: false,
        message: 'Photo mise à jour avec succès',
        photo: updatedPhoto,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! SUPPRIMER UNE PHOTO DU PORTFOLIO
  async deletePortfolioPhoto(id: string, userId: string) {
    try {
      // Vérifier si la photo existe
      const existingPhoto = await this.prisma.portfolio.findUnique({
        where: { id },
      });

      if (!existingPhoto) {
        throw new Error('Photo non trouvée');
      }

      if (existingPhoto.userId !== userId) {
        return {
          error: true,
          message: 'Non autorisé à supprimer cette photo.',
        };
      }

      // Supprimer la photo
      await this.prisma.portfolio.delete({
        where: { id },
      });

      // Invalider le cache après suppression
      await this.cacheService.delPattern(`portfolio:photos:${existingPhoto.userId}:*`);

      return { message: 'Photo supprimée avec succès' };
    } catch (error) {
      throw new Error('Erreur lors de la suppression de la photo du portfolio : ' + error);
    }
  }
}
