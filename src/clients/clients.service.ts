/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  //! CREER UN CLIENT
  async createClient({ clientBody }: { clientBody: CreateClientDto }) {
    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        birthDate,
        address,
        userId,
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
  
      // Créer le client
      const newClient = await this.prisma.client.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          birthDate: new Date(birthDate),
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

  //! CREER UN CLIENT VIA RDV
  async createClientFromAppointment(appointmentId: string, userId: string) {
    // Récupérer le rendez-vous
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        tattooDetail: true,
      }
    })

    if (!appointment) {
      return {
        error: true,
        message: 'Rendez-vous introuvable.',
      };
    }

    // Vérifier si le client existe déjà
    const existingClient = await this.prisma.client.findUnique({
      where: {
        email: appointment.clientEmail,
      },
    });

    if (existingClient) {
      return {
        error: false,
        message: 'Client déjà existant.',
        client: existingClient,
      };
    }

    // Split du nom
    const [firstName, ...rest] = appointment.clientName.split(" ");
    const lastName = rest.join(" ") || "";

    // Préparer proprement les infos du TattooDetail s’il existe
    let tattooDetailData: Prisma.TattooDetailCreateNestedOneWithoutClientInput | undefined;

    if (appointment.tattooDetail) {
      const detail = appointment.tattooDetail;

      tattooDetailData = {
        create: {
          description: detail.description,
          zone: detail.zone,
          size: detail.size,
          colorStyle: detail.colorStyle,
          reference: detail.reference ?? undefined,
          sketch: detail.sketch ?? undefined,
          estimatedPrice: detail.estimatedPrice ?? undefined,
        },
      };
    }

    // Créer le client
    const client = await this.prisma.client.create({
      data: {
        userId,
        firstName,
        lastName,
        email: appointment.clientEmail,
        phone: appointment.clientPhone || "", // Si vide, valeur par défaut
        birthDate: appointment.clientBirthDate ?? new Date("2000-01-01"),
        address: "",
        tattooDetail: tattooDetailData,
      },
    });

    // Mettre à jour le RDV pour le lier au client
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        clientId: client.id,
      },
    });

    return {
      error: false,
      message: "Fiche client créée à partir du rendez-vous.",
      client,
    };
  }

  //! VOIR UN SEUL CLIENT
  async getClientById(clientId: string) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        include: {
          tattooDetail: true,
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
  async getClientsBySalon(userId: string) {
    try {
      const clients = await this.prisma.client.findMany({
        where: { userId },
        include: {
          tattooDetail: true,
          medicalHistory: true,
          tattooHistory: true,
          aftercareRecords: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!clients || clients.length === 0) {
        throw new Error('Aucun client trouvé.');
      }

      // Vérifier si le salon a des clients
      if (clients.length === 0) {
        throw new Error('Aucun client trouvé pour ce salon.');
      }

      return clients;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! MODIFIER UN CLIENT
  async updateClient(clientId: string, clientBody: CreateClientDto) {
    try {
      const { firstName, lastName, email, phone, birthDate, address } = clientBody;

      const updatedClient = await this.prisma.client.update({
        where: { id: clientId },
        data: {
          firstName,
          lastName,
          email,
          phone,
          birthDate: new Date(birthDate),
          address,
        },
      });

      if (!updatedClient) {
        throw new Error('Client introuvable.');
      }

      return {
        error: false,
        message: 'Client mis à jour avec succès.',
        client: updatedClient,
      };
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
      const deletedClient = await this.prisma.client.delete({
        where: { id: clientId },
      });

      if (!deletedClient) {
        throw new Error('Client introuvable.');
      }

      return {
        error: false,
        message: 'Client supprimé avec succès.',
        client: deletedClient,
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
