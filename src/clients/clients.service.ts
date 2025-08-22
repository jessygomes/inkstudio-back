import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { SaasService } from 'src/saas/saas.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasService: SaasService
  ) {}

  //! CREER UN CLIENT
  async createClient({ clientBody, userId }: { clientBody: CreateClientDto, userId: string }) {
    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        birthDate,
        address,
        description,
        zone,
        size,
        colorStyle,
        reference,
        sketch,
        estimatedPrice,
        allergies,
        healthIssues,
        medications,
        pregnancy,
        tattooHistory,
      } = clientBody;

      // 🔒 VÉRIFIER LES LIMITES SAAS AVANT DE CRÉER LE CLIENT
      const canCreateClient = await this.saasService.canPerformAction(userId, 'client');
      
      if (!canCreateClient) {
        const limits = await this.saasService.checkLimits(userId);
        console.log(`Limites actuelles pour l'utilisateur ${userId}:`, limits);
        return {
          error: true,
          message: `Limite de fiches clients atteinte (${limits.limits.clients}). Passez au plan PRO ou BUSINESS pour continuer.`,
        };
      }
  
      // Créer le client
      const newClient = await this.prisma.client.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          birthDate: birthDate ? new Date(birthDate) : undefined,
          address,
          userId,
        },
      });

      const result: any = {
        error: false,
        message: 'Client créé avec succès.',
        client: newClient,
      };

      // Créer tattooDetail si au moins un champ existe
      const hasTattooData =
      description || zone || size || colorStyle || reference || sketch || estimatedPrice !== undefined;

      if (hasTattooData) {
        const tattooDetail = await this.prisma.tattooDetail.create({
          data: {
            clientId: newClient.id,
            description,
            zone,
            size,
            colorStyle,
            reference,
            sketch,
            estimatedPrice,
          },
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        result.tattooDetail = tattooDetail;
      }
         // Créer medicalHistory si au moins un champ existe
      const hasMedicalData =
      allergies || healthIssues || medications || pregnancy !== undefined || tattooHistory;

      if (hasMedicalData) {
        const medicalHistory = await this.prisma.medicalHistory.create({
          data: {
            clientId: newClient.id,
            allergies,
            healthIssues,
            medications,
            pregnancy: pregnancy ?? false,
            tattooHistory,
          },
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        result.medicalHistory = medicalHistory;
      }
  
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  // //! CREER UN CLIENT VIA RDV
  // async createClientFromAppointment(appointmentId: string, userId: string) {
  //   // Récupérer le rendez-vous
  //   const appointment = await this.prisma.appointment.findUnique({
  //     where: { id: appointmentId },
  //     include: {
  //       tattooDetail: true,
  //     }
  //   })

  //   if (!appointment) {
  //     return {
  //       error: true,
  //       message: 'Rendez-vous introuvable.',
  //     };
  //   }

  //   // Vérifier si le client existe déjà
  //   const existingClient = await this.prisma.client.findUnique({
  //     where: {
  //       email: appointment.clientEmail,
  //     },
  //   });

  //   if (existingClient) {
  //     return {
  //       error: false,
  //       message: 'Client déjà existant.',
  //       client: existingClient,
  //     };
  //   }

  //   // Préparer proprement les infos du TattooDetail s’il existe
  //   let tattooDetailData: Prisma.TattooDetailCreateNestedOneWithoutClientInput | undefined;

  //   if (appointment.tattooDetail) {
  //     const detail = appointment.tattooDetail;

  //     tattooDetailData = {
  //       create: {
  //         description: detail.description,
  //         zone: detail.zone,
  //         size: detail.size,
  //         colorStyle: detail.colorStyle,
  //         reference: detail.reference ?? undefined,
  //         sketch: detail.sketch ?? undefined,
  //         estimatedPrice: detail.estimatedPrice ?? undefined,
  //       },
  //     };
  //   }

  //   // Créer le client
  //   const client = await this.prisma.client.create({
  //     data: {
  //       userId,
  //       firstName: appointment.clientFirstname,
  //       lastName : appointment.clientLastname,
  //       email: appointment.clientEmail,
  //       phone: appointment.clientPhone || "", // Si vide, valeur par défaut
  //       birthDate: appointment.clientBirthDate ?? new Date("2000-01-01"),
  //       address: "",
  //       tattooDetail: tattooDetailData,
  //     },
  //   });

  //   // Mettre à jour le RDV pour le lier au client
  //   await this.prisma.appointment.update({
  //     where: { id: appointmentId },
  //     data: {
  //       clientId: client.id,
  //     },
  //   });

  //   return {
  //     error: false,
  //     message: "Fiche client créée à partir du rendez-vous.",
  //     client,
  //   };
  // }

  //! VOIR UN SEUL CLIENT
  async getClientById(clientId: string) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        include: {
          tattooDetails: true,
          medicalHistory: true,
          tattooHistory: true,
          aftercareRecords: true,
        },
      });

      if (!client) {
        throw new Error('Client introuvable.');
      }

      return client;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      }; 
    }
  }

  //! VOIR TOUS LES CLIENTS D'UN SALON
  async getClientsBySalon(userId: string, page: number, limit: number, search: string) {
    try {
      const skip = (page - 1) * limit;

          // Construire les conditions de recherche
      const searchConditions = search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const whereClause = {
        userId,
        ...searchConditions,
      };

      const totalClients = await this.prisma.client.count({
        where: whereClause,
      });

      const clients = await this.prisma.client.findMany({
        where: whereClause,
        include: {
          appointments: true,
          medicalHistory: true,
          tattooHistory: true,
          aftercareRecords: true,
          FollowUpSubmission: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const totalPages = Math.ceil(totalClients / limit);

      if (!clients || clients.length === 0) {
        throw new Error('Aucun client trouvé.');
      }

      // Vérifier si le salon a des clients
      if (clients.length === 0) {
        throw new Error('Aucun client trouvé pour votre salon.');
      }

      return {
        error : false,
        clients,
        pagination: {
          currentPage: page,
          totalPages,
          totalClients,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        }
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! SEARCH CLIENTS BY NAME OR EMAIL (for reservation form)
  async searchClients(query: string, userId: string) {
    try {
      console.log('Searching clients with query:', query, 'for userId:', userId);

      const clients = await this.prisma.client.findMany({
        where: {
          AND: [
            { userId },
            {
              OR: [
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            },
          ],
        },
        take: 10,
      });

      if (!clients || clients.length === 0) {
        return {
          error: false,
          message: 'Aucun client trouvé.',
          clients: [],
        };
      }

      return {
        error: false,
        message: 'Clients trouvés avec succès.',
        clients,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
        clients: [],
      };
    }
  }

  //! MODIFIER UN CLIENT
  async updateClient(clientId: string, clientBody: CreateClientDto) {
    try {
      const { firstName, lastName, email, phone, birthDate, address, allergies,
        healthIssues,
        medications,
        pregnancy,
        tattooHistory, } = clientBody;

      // Préparer les données à mettre à jour
      const updateData: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        address: string;
        birthDate?: Date;
      } = {
        firstName,
        lastName,
        email,
        phone,
        address,
      };

      // Ajouter birthDate seulement si elle est fournie et valide
      if (birthDate && birthDate.trim() !== '') {
        updateData.birthDate = new Date(birthDate);
      }

      const updatedClient = await this.prisma.client.update({
        where: { id: clientId },
        data: updateData,
      });

      const result: any = {
        error: false,
        message: 'Client mis à jour avec succès.',
        client: updatedClient,
      };

      // Gérer l'historique médical : créer ou mettre à jour
      const hasMedicalData =
        allergies || healthIssues || medications || pregnancy !== undefined || tattooHistory;

      if (hasMedicalData) {
        // Vérifier si un historique médical existe déjà
        const existingMedicalHistory = await this.prisma.medicalHistory.findUnique({
          where: { clientId: updatedClient.id },
        });

        if (existingMedicalHistory) {
          // Mettre à jour l'historique médical existant
          const updatedMedicalHistory = await this.prisma.medicalHistory.update({
            where: { clientId: updatedClient.id },
            data: {
              allergies,
              healthIssues,
              medications,
              pregnancy: pregnancy ?? false,
              tattooHistory,
            },
          });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          result.medicalHistory = updatedMedicalHistory;
        } else {
          // Créer un nouvel historique médical
          const newMedicalHistory = await this.prisma.medicalHistory.create({
            data: {
              clientId: updatedClient.id,
              allergies,
              healthIssues,
              medications,
              pregnancy: pregnancy ?? false,
              tattooHistory,
            },
          });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          result.medicalHistory = newMedicalHistory;
        }
      }

      if (!updatedClient) {
        throw new Error('Client introuvable.');
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! SUPPRIMER UN CLIENT
  async deleteClient(clientId: string) {
    try {
      // Utiliser une transaction pour supprimer toutes les relations liées
      await this.prisma.$transaction(async (prisma) => {
        // 1. Supprimer l'historique médical s'il existe
        await prisma.medicalHistory.deleteMany({
          where: { clientId },
        });

        // 2. Supprimer l'historique des tatouages
        await prisma.tattooHistory.deleteMany({
          where: { clientId },
        });

        // 3. Supprimer les enregistrements de suivi (aftercare)
        await prisma.aftercare.deleteMany({
          where: { clientId },
        });

        // 4. Supprimer les soumissions de suivi
        await prisma.followUpSubmission.deleteMany({
          where: { clientId },
        });

        // 5. Détacher le client des rendez-vous (mettre clientId à null au lieu de supprimer les RDV)
        await prisma.appointment.updateMany({
          where: { clientId },
          data: { clientId: null },
        });

        // 6. Supprimer les détails de tatouage liés au client
        await prisma.tattooDetail.deleteMany({
          where: { clientId },
        });

        // 7. Enfin, supprimer le client
        await prisma.client.delete({
          where: { id: clientId },
        });
      });

      return {
        error: false,
        message: 'Client supprimé avec succès.',
      };
    } catch (error: unknown) {
      console.error('Erreur lors de la suppression du client:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la suppression : ${errorMessage}`,
      };
    }
  }

    // ! -------------------------------------------------------------------------

  //! DASHBOARD - STATISTIQUES

  // ! --------------------------------------------------------------------------

  //! NOMRE DE NVX CLIENTS PAR MOIS
  async getNewClientsCountByMonth(userId: string, month: number, year: number) {
    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0); // Dernier jour du mois
      const newClientsCount = await this.prisma.client.count({
        where: {
          userId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
      return {
        error: false,
        month,
        year,
        newClientsCount,
      };
    }
    catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
