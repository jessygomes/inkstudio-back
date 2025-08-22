import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { SaasService } from 'src/saas/saas.service';

@Injectable()
export class TatoueursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasService: SaasService
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
      const tatoueurs = await this.prisma.tatoueur.findMany();
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
      const tatoueurs = await this.prisma.tatoueur.findMany({
        where: {
          userId,
        },
      });
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
      const tatoueur = await this.prisma.tatoueur.findUnique({
        where: {
          id,
        },
      });
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
      const { name, img, description, phone, instagram, hours, style, skills } = tatoueurBody;

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
        },
      });

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
