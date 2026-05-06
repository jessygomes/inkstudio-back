import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AddPhotoDto } from './dto/add-photo.dto';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasService: SaasService,
    private cacheService: CacheService
  ) {}

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

      // 🔒 VÉRIFIER LES LIMITES SAAS - IMAGES PORTFOLIO
      const canAddPortfolioImage = await this.saasService.canPerformAction(userId, 'portfolio');
      
      if (!canAddPortfolioImage) {
        const limits = await this.saasService.checkLimits(userId);
        return {
          error: true,
          message: `Limite d'images portfolio atteinte (${limits.limits.portfolioImages}). Passez au plan PRO ou BUSINESS pour continuer.`,
        };
      }

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
  async getPortfolioPhotos(userId: string, tatoueurId?: string, page: number = 1) {
    try {
      const pageSize = 10;
      const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;
      const skip = (currentPage - 1) * pageSize;
      const cacheKey = `portfolio:photos:${userId}:${tatoueurId ?? 'all'}:page:${currentPage}`;

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

      const whereClause = {
        userId,
        ...(tatoueurId ? { tatoueurId } : {}),
      };

      const total = await this.prisma.portfolio.count({
        where: whereClause,
      });

      // 2. Sinon, aller chercher en DB
      const photos = await this.prisma.portfolio.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' }, // Optionnel : trier par date de création
        skip,
        take: pageSize,
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

      // 3. Mettre en cache (TTL 15 minutes pour les photos portfolio)
      await this.cacheService.set(cacheKey, response, 900);

      return response;
    } catch (error) {
      throw new Error('Erreur lors de la récupération des photos du portfolio : ' + error);
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

      // Mettre à jour la photo
      const updatedPhoto = await this.prisma.portfolio.update({
        where: { id },
        data: updateData,
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
