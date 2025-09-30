import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';

@Injectable()
export class TatoueursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasService: SaasService,
    private cacheService: CacheService
  ) {}

  //! CREER UN TATOUEUR
  async create({ tatoueurBody, userId }: {tatoueurBody: CreateTatoueurDto, userId: string}) {
    try {
      const { name, img, description, phone, instagram, hours, style, skills } = tatoueurBody;

      // 🔒 VÉRIFIER LES LIMITES SAAS - TATOUEURS
      const canCreateTatoueur = await this.saasService.canPerformAction(userId, 'tatoueur');
      
      if (!canCreateTatoueur) {
        const limits = await this.saasService.checkLimits(userId);
        return {
          error: true,
          message: `Limite de tatoueurs atteinte (${limits.limits.tattooeurs}). Passez au plan PRO ou BUSINESS pour continuer.`,
        };
      }

      // Créer le tatoueur
      const newTatoueur = await this.prisma.tatoueur.create({
        data: {
          name,
          img,
          description,
          phone,
          instagram,
          hours,
          userId,
          style,
          skills,
        },
      });

      // Invalider le cache après création
      await this.cacheService.del(`tatoueurs:all`);
      await this.cacheService.del(`tatoueurs:user:${userId}`);
      await this.cacheService.del(`tatoueurs:user:${userId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur créé avec succès.',
        tatoueur: newTatoueur,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR TOUS LES TATOUEURS
  async getAllTatoueurs() {
    try {
      const cacheKey = `tatoueurs:all`;

      // 1. Vérifier dans Redis
      const cachedTatoueurs = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedTatoueurs) {
        console.log(`✅ Tous les tatoueurs trouvés dans Redis`);
        return cachedTatoueurs;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueurs = await this.prisma.tatoueur.findMany();

      // 3. Mettre en cache (TTL 30 minutes pour tous les tatoueurs)
      await this.cacheService.set(cacheKey, tatoueurs, 1800);
      console.log(`💾 Tous les tatoueurs mis en cache`);

      return tatoueurs;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      }; 
    }
  }

  //! VOIR TOUS LES TATOUEURS PAR USER ID
  async getTatoueurByUserId(userId: string) {
    try {
      const cacheKey = `tatoueurs:user:${userId}`;

      // 1. Vérifier dans Redis
      const cachedTatoueurs = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedTatoueurs) {
        console.log(`✅ Tatoueurs pour user ${userId} trouvés dans Redis`);
        return cachedTatoueurs;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueurs = await this.prisma.tatoueur.findMany({
        where: {
          userId,
        },
      });

      // 3. Mettre en cache (TTL 20 minutes pour les tatoueurs d'un salon)
      await this.cacheService.set(cacheKey, tatoueurs, 1200);
      console.log(`💾 Tatoueurs pour user ${userId} mis en cache`);

      return tatoueurs;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! VOIR TOUS LES TATOUEURS QUI PEUVENT PRENDRE DES RDV PAR USER ID
  async getTatoueurByUserIdForAppointment(userId: string) {
    try {
      const cacheKey = `tatoueurs:user:${userId}:appointment-enabled`;

      // 1. Vérifier dans Redis
      const cachedTatoueurs = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        rdvBookingEnabled: boolean;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedTatoueurs) {
        console.log(`✅ Tatoueurs RDV-enabled pour user ${userId} trouvés dans Redis`);
        return cachedTatoueurs;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueurs = await this.prisma.tatoueur.findMany({
        where: {
          userId,
          rdvBookingEnabled: true
        },
      });

      // 3. Mettre en cache (TTL 15 minutes pour les tatoueurs RDV-enabled)
      await this.cacheService.set(cacheKey, tatoueurs, 900);
      console.log(`💾 Tatoueurs RDV-enabled pour user ${userId} mis en cache`);

      return tatoueurs;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR UN SEUL TATOUEUR
  async getOneTatoueur(id: string) {
    try {
      const cacheKey = `tatoueur:${id}`;

      // 1. Vérifier dans Redis
      const cachedTatoueur = await this.cacheService.get<{
        id: string;
        name: string;
        img: string;
        description: string;
        [key: string]: any;
      }>(cacheKey);
      
      if (cachedTatoueur) {
        console.log(`✅ Tatoueur ${id} trouvé dans Redis`);
        return cachedTatoueur;
      }

      // 2. Sinon, aller chercher en DB
      const tatoueur = await this.prisma.tatoueur.findUnique({
        where: {
          id,
        },
      });

      // 3. Mettre en cache si trouvé (TTL 30 minutes pour un tatoueur spécifique)
      if (tatoueur) {
        await this.cacheService.set(cacheKey, tatoueur, 1800);
        console.log(`💾 Tatoueur ${id} mis en cache`);
      }

      return tatoueur;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! MODIFIER UN TATOUEUR
  async updateTatoueur(id: string, tatoueurBody: CreateTatoueurDto) {
    try {
      const { name, img, description, phone, instagram, hours, style, skills, rdvBookingEnabled } = tatoueurBody;

      const updatedTatoueur = await this.prisma.tatoueur.update({
        where: {
          id,
        },
        data: {
          name,
          img,
          description,
          phone,
          instagram,
          hours,
          style,
          skills,
          rdvBookingEnabled
        },
      });

      // Invalider le cache après mise à jour
      await this.cacheService.del(`tatoueur:${id}`);
      await this.cacheService.del(`tatoueurs:all`);
      await this.cacheService.del(`tatoueurs:user:${updatedTatoueur.userId}`);
      await this.cacheService.del(`tatoueurs:user:${updatedTatoueur.userId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur modifié avec succès.',
        tatoueur: updatedTatoueur,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! SUPPRIMER UN TATOUEUR
  async deleteTatoueur(id: string) {
    try {
      const deletedTatoueur = await this.prisma.tatoueur.delete({
        where: {
          id,
        },
      });

      // Invalider le cache après suppression
      await this.cacheService.del(`tatoueur:${id}`);
      await this.cacheService.del(`tatoueurs:all`);
      await this.cacheService.del(`tatoueurs:user:${deletedTatoueur.userId}`);
      await this.cacheService.del(`tatoueurs:user:${deletedTatoueur.userId}:appointment-enabled`);

      return {
        error: false,
        message: 'Tatoueur supprimé avec succès.',
        tatoueur: deletedTatoueur,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
