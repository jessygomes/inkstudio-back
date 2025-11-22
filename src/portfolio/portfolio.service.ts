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
      await this.cacheService.del(`portfolio:photos:${userId}`);

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
  async getPortfolioPhotos(userId: string) {
    try {
      const cacheKey = `portfolio:photos:${userId}`;

      // 1. Vérifier dans Redis
      const cachedPhotos = await this.cacheService.get<{
        id: string;
        title: string;
        imageUrl: string;
        description: string;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedPhotos) {
        return cachedPhotos;
      }

      // 2. Sinon, aller chercher en DB
      const photos = await this.prisma.portfolio.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }, // Optionnel : trier par date de création
      });

      // 3. Mettre en cache (TTL 15 minutes pour les photos portfolio)
      await this.cacheService.set(cacheKey, photos, 900);

      return photos;
    } catch (error) {
      throw new Error('Erreur lors de la récupération des photos du portfolio : ' + error);
    }
  }

  //! MODIFIER UNE PHOTO DU PORTFOLIO
  async updatePortfolioPhoto(id: string, updateData: Partial<AddPhotoDto>) {
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

      // Mettre à jour la photo
      const updatedPhoto = await this.prisma.portfolio.update({
        where: { id },
        data: updateData,
      });

      // Invalider le cache après mise à jour
      await this.cacheService.del(`portfolio:photos:${existingPhoto.userId}`);

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
  async deletePortfolioPhoto(id: string) {
    try {
      // Vérifier si la photo existe
      const existingPhoto = await this.prisma.portfolio.findUnique({
        where: { id },
      });

      if (!existingPhoto) {
        throw new Error('Photo non trouvée');
      }

      // Supprimer la photo
      await this.prisma.portfolio.delete({
        where: { id },
      });

      // Invalider le cache après suppression
      await this.cacheService.del(`portfolio:photos:${existingPhoto.userId}`);

      return { message: 'Photo supprimée avec succès' };
    } catch (error) {
      throw new Error('Erreur lors de la suppression de la photo du portfolio : ' + error);
    }
  }
}
