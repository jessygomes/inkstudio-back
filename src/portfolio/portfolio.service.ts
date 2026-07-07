import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AddPhotoDto } from './dto/add-photo.dto';
import { CacheService } from 'src/redis/cache.service';

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
      const { title, imageUrl, description, tatoueurId } = portfolioBody;
      const normalizedStyles = this.normalizeStyles((portfolioBody as { style?: unknown }).style);

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

      // Ajouter la photo au portfolio
      const newPhoto = await this.prisma.portfolio.create({
        data: {
          userId,
          title,
          imageUrl,
          description,
          tatoueurId,
          style: normalizedStyles,
        },
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

  //! VOIR TOUTES LES PHOTOS D'UN PORTFOLIO
  async getPortfolioPhotos(userId: string, tatoueurId?: string, page: number = 1, limit?: number) {
    try {
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
      const cacheKey = `portfolio:photos:${userId}:${tatoueurId ?? 'all'}:page:${currentPage}:limit:${normalizedLimit ?? 'all'}`;

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
      
      if (cachedPhotos) {
        return cachedPhotos;
      }

      const requestedUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          linkedTatoueurs: {
            select: {
              id: true,
              salonName: true,
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
              tatoueurUser.salonName?.trim() || 'Tatoueur',
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

      const whereClause: Record<string, any> = {
        userId: linkedTatoueurFilterUserId
          ? linkedTatoueurFilterUserId
          : portfolioOwnerIds.length === 1
            ? portfolioOwnerIds[0]
            : { in: portfolioOwnerIds },
        ...(normalizedTatoueurId && !linkedTatoueurFilterUserId
          ? { tatoueurId: normalizedTatoueurId }
          : {}),
      };

      const total = await this.prisma.portfolio.count({
        where: whereClause,
      });

      // 2. Sinon, aller chercher en DB
      const photosFromDb = await this.prisma.portfolio.findMany({
        where: whereClause,
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
      await this.cacheService.set(cacheKey, response, 900);

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
  }: {
    page?: number;
    limit?: number;
    city?: string;
    style?: string;
  }) {
    try {
      const pageSize = Math.min(50, Math.max(1, Number(limit) || 12));
      const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;
      const skip = (currentPage - 1) * pageSize;
      const normalizedCity = city?.trim() || '';
      const styleFilters = (style ?? '')
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
      const cacheKey = `portfolio:inspirations:page:${currentPage}:limit:${pageSize}:city:${normalizedCity || 'all'}:style:${styleFilters.length ? styleFilters.join('|') : 'all'}`;

      const cachedPhotos = await this.cacheService.get<{
        photos: any[];
        pagination: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>(cacheKey);

      if (cachedPhotos) {
        return cachedPhotos;
      }

      const whereClause: Record<string, any> = {
        user: {
          isInspirationSalon: true,
          ...(normalizedCity
            ? {
                city: {
                  contains: normalizedCity,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        },
        ...(styleFilters.length > 0
          ? {
              style: {
                hasSome: styleFilters,
              },
            }
          : {}),
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
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              salonName: true,
              image: true,
              city: true,
              postalCode: true,
              instagram: true,
              isInspirationSalon: true,
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
        photos,
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

      if (updateData.tatoueurId) {
        const tatoueurValidation = await this.validateTatoueurForSalon(updateData.tatoueurId, userId);
        if (tatoueurValidation) {
          return tatoueurValidation;
        }
      }

      const dataToUpdate: Partial<AddPhotoDto> = {
        ...updateData,
        ...(updateData.style !== undefined
          ? { style: this.normalizeStyles((updateData as { style?: unknown }).style) }
          : {}),
      };

      // Mettre à jour la photo
      const updatedPhoto = await this.prisma.portfolio.update({
        where: { id },
        data: dataToUpdate,
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
