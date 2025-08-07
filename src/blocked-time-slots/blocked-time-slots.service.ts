import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateBlockedSlotDto } from './dto/create-blocked-slot.dto';
import { UpdateBlockedSlotDto } from './dto/update-blocked-slot.dto';

@Injectable()
export class BlockedTimeSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  //! CRÉER UN CRÉNEAU BLOQUÉ
  async createBlockedSlot(blockedSlotData: CreateBlockedSlotDto) {
    try {
      console.log('Données reçues:', blockedSlotData);
      
      const { startDate, endDate, reason, tatoueurId, userId } = blockedSlotData;

      // Validation des données requises
      if (!startDate || !endDate || !userId) {
        return {
          error: true,
          message: 'Les champs startDate, endDate et userId sont requis.',
        };
      }

      // Vérifier et convertir les dates
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Vérifier si les dates sont valides
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return {
          error: true,
          message: 'Les dates fournies ne sont pas valides.',
        };
      }

      if (start >= end) {
        return {
          error: true,
          message: 'La date de fin doit être postérieure à la date de début.',
        };
      }

      console.log('Dates converties:', { start, end });
      console.log('Autres données:', { reason, tatoueurId, userId });

      // Créer le créneau bloqué
      const blockedSlot = await this.prisma.blockedTimeSlot.create({
        data: {
          startDate: start,
          endDate: end,
          reason: reason || null,
          tatoueurId: tatoueurId || null,
          userId,
        },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        error: false,
        message: 'Créneau bloqué créé avec succès.',
        blockedSlot,
      };
    } catch (error: unknown) {
      console.error('Erreur lors de la création du créneau bloqué:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR TOUS LES CRÉNEAUX BLOQUÉS D'UN SALON
  async getBlockedSlotsBySalon(userId: string) {
    try {
      const blockedSlots = await this.prisma.blockedTimeSlot.findMany({
        where: { userId },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { startDate: 'asc' },
      });

      return {
        error: false,
        blockedSlots,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR TOUS LES CRÉNEAUX BLOQUÉS D'UN TATOUEUR
  async getBlockedSlotsByTatoueur(tatoueurId: string) {
    try {
      const blockedSlots = await this.prisma.blockedTimeSlot.findMany({
        where: { tatoueurId },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { startDate: 'asc' },
      });

      return {
        error: false,
        blockedSlots,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VÉRIFIER SI UN CRÉNEAU EST BLOQUÉ
  async isTimeSlotBlocked(startDate: Date, endDate: Date, tatoueurId?: string, userId?: string): Promise<boolean> {
    try {
      // Construire les conditions de recherche de base
      const whereConditions: {
        AND: Array<{
          startDate?: { lt: Date };
          endDate?: { gt: Date };
        }>;
        OR?: Array<{ tatoueurId: string | null }>;
        userId?: string;
      } = {
        AND: [
          {
            startDate: {
              lt: endDate, // Le blocage commence avant la fin du créneau
            },
          },
          {
            endDate: {
              gt: startDate, // Le blocage se termine après le début du créneau
            },
          },
        ],
      };

      // Si on cherche pour un tatoueur spécifique
      if (tatoueurId) {
        whereConditions.OR = [
          { tatoueurId: tatoueurId }, // Bloqué spécifiquement pour ce tatoueur
          { tatoueurId: null }, // Bloqué pour tous les tatoueurs du salon
        ];
        
        if (userId) {
          whereConditions.userId = userId; // S'assurer qu'on reste dans le bon salon
        }
      } else if (userId) {
        // Si on cherche pour le salon en général
        whereConditions.userId = userId;
      }

      const blockedSlot = await this.prisma.blockedTimeSlot.findFirst({
        where: whereConditions,
      });

      return !!blockedSlot; // Retourne true si un blocage est trouvé
    } catch (error) {
      console.error('Erreur lors de la vérification de blocage:', error);
      return false; // En cas d'erreur, on considère que ce n'est pas bloqué
    }
  }

  //! MODIFIER UN CRÉNEAU BLOQUÉ
  async updateBlockedSlot(id: string, updateData: UpdateBlockedSlotDto) {
    try {
      // Vérifier si le créneau bloqué existe
      const existingSlot = await this.prisma.blockedTimeSlot.findUnique({
        where: { id },
      });

      if (!existingSlot) {
        return {
          error: true,
          message: 'Créneau bloqué introuvable.',
        };
      }

      // Préparer les données à mettre à jour avec un type approprié
      const updatePayload: {
        startDate?: Date;
        endDate?: Date;
        reason?: string;
        tatoueurId?: string | null;
      } = {};

      if (updateData.startDate) {
        updatePayload.startDate = new Date(updateData.startDate);
      }
      if (updateData.endDate) {
        updatePayload.endDate = new Date(updateData.endDate);
      }
      if (updateData.reason !== undefined) {
        updatePayload.reason = updateData.reason;
      }
      if (updateData.tatoueurId !== undefined) {
        updatePayload.tatoueurId = updateData.tatoueurId || null;
      }

      // Vérifier les dates si elles sont modifiées
      const startDate = updatePayload.startDate || existingSlot.startDate;
      const endDate = updatePayload.endDate || existingSlot.endDate;

      if (startDate >= endDate) {
        return {
          error: true,
          message: 'La date de fin doit être postérieure à la date de début.',
        };
      }

      const updatedSlot = await this.prisma.blockedTimeSlot.update({
        where: { id },
        data: updatePayload,
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        error: false,
        message: 'Créneau bloqué mis à jour avec succès.',
        blockedSlot: updatedSlot,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! SUPPRIMER UN CRÉNEAU BLOQUÉ
  async deleteBlockedSlot(id: string) {
    try {
      // Vérifier si le créneau bloqué existe
      const existingSlot = await this.prisma.blockedTimeSlot.findUnique({
        where: { id },
      });

      if (!existingSlot) {
        return {
          error: true,
          message: 'Créneau bloqué introuvable.',
        };
      }

      await this.prisma.blockedTimeSlot.delete({
        where: { id },
      });

      return {
        error: false,
        message: 'Créneau bloqué supprimé avec succès.',
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
