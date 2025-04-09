import { Injectable } from '@nestjs/common';
import { CreateTattooHistoryDto } from './dto/create-tattoohistory.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class TattooHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  //! CREER UN HISTORIQUE DE TATOUAGE
  async createHistory(data: CreateTattooHistoryDto) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: data.clientId },
      });

      if (!client) {
        return {
          error: true,
          message: "Client introuvable.",
        };
      }

      const history = await this.prisma.tattooHistory.create({
        data: {
          clientId: data.clientId,
          date: new Date(data.date),
          description: data.description,
          beforeImage: data.beforeImage,
          afterImage: data.afterImage,
          inkUsed: data.inkUsed,
          healingTime: data.healingTime,
          careProducts: data.careProducts,
        },
      });

      return {
        error: false,
        message: "Historique du tatouage ajouté avec succès.",
        history,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      return { error: true, message };
    }
  }

  //! MODIFIER UN HISTORIQUE DE TATOUAGE
  async updateHistory(id: string, data: CreateTattooHistoryDto) {
    try {
      const history = await this.prisma.tattooHistory.update({
        where: { id },
        data: {
          date: new Date(data.date),
          description: data.description,
          beforeImage: data.beforeImage,
          afterImage: data.afterImage,
          inkUsed: data.inkUsed,
          healingTime: data.healingTime,
          careProducts: data.careProducts,
        },
      });

      return {
        error: false,
        message: "Historique du tatouage mis à jour avec succès.",
        history,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      return { error: true, message };
    }
  }

  //! SUPPRIMER UN HISTORIQUE DE TATOUAGE
  async deleteHistory(id: string) {
    try {
      const history = await this.prisma.tattooHistory.delete({
        where: { id },
      });

      return {
        error: false,
        message: "Historique du tatouage supprimé avec succès.",
        history,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      return { error: true, message };
    }
  }

  //! AFFICHER TOUS LES HISTORIQUES DES TATOUAGES DE TOUS LES CLIENTS DU SALON
  async getSalonTattooHistories(userId: string) {
    try {
      const histories = await this.prisma.tattooHistory.findMany({
        where: {
          client: {
            userId: userId,
          },
        },
        orderBy: {
          date: 'desc',
        },
      });
  
      return {
        error: false,
        message: 'Historique des tatouages récupéré avec succès.',
        histories,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      return { error: true, message };
    }
  }

}
