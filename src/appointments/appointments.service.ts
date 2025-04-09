/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAppointmentDto, PrestationType } from './dto/create-appointment.dto';


@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  //! CREER UN RDV
  async create({ rdvBody }: {rdvBody: CreateAppointmentDto}) {
   try {
      const { title, prestation, start, end, clientName, clientEmail, tatoueurId } = rdvBody;

        // Vérifier si le tatoueur existe
        const artist = await this.prisma.tatoueur.findUnique({
          where: {
            id: tatoueurId,
          },
        });

        if (!artist) {
          return {
            error: true,
            message: 'Tatoueur introuvable.',
          };
        }

      // Vérifier si il y a deja un rendez-vous à ce créneau horaire avec ce tatoueur
      const existingAppointment = await this.prisma.appointment.findFirst({
        where: {
          tatoueurId: tatoueurId,
          start: {
            gte: new Date(start),
            lte: new Date(end),
          },
        },
      });

      if (existingAppointment) {
        return {
          error: true,
          message: 'Ce créneau horaire est déjà réservé.',
        };
      }

      if (prestation === PrestationType.PROJET) {
        const newAppointment = await this.prisma.appointment.create({
          data: {
            title,
            prestation,
            start: new Date(start),
            end: new Date(end),
            clientName,
            clientEmail,
            tatoueurId,
          },
        });
      
        const tattooDetail = await this.prisma.tattooDetail.create({
          data: {
            appointmentId: newAppointment.id,
            type: rdvBody.type || '',
            zone: rdvBody.zone || '',
            size: rdvBody.size || '',
            colorStyle: rdvBody.colorStyle || '',
            reference: rdvBody.reference,
            sketch: rdvBody.sketch,
            estimatedPrice: rdvBody.estimatedPrice,
          },
        });
      
        return {
          error: false,
          message: 'Rendez-vous projet créé avec détail tatouage.',
          appointment: newAppointment,
          tattooDetail,
        };
      }

      // Créer le rendez-vous
      const newAppointment = await this.prisma.appointment.create({
        data: {
          title,
          prestation,
          start: new Date(start),
          end: new Date(end),
          clientName,
          clientEmail,
          tatoueurId,
        },
      });

      return {
        error: false,
        message: 'Rendez-vous créé avec succès.',
        appointment: newAppointment,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! VOIR TOUS LES RDV
  async getAllAppointments() {
    try {
      const appointments = await this.prisma.appointment.findMany({
        include: {
          // tatoueur: true,
          tattooDetail: true,
        },
      });
      return appointments;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! VOIR UN SEUL RDV
  async getOneAppointment(id: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: {
          id,
        },
        include: {
          tatoueur: true,
          tattooDetail: true,
        },
      });
      return appointment;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! SUPPRIMER UN RDV
  async deleteAppointment(id: string) {
    try {
      const appointment = await this.prisma.appointment.delete({
        where: {
          id,
        },
      });
      return appointment;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  // ! MODIFIER UN RDV
  async updateAppointment(id: string, rdvBody: CreateAppointmentDto) {
    try {
      const { title, prestation, start, end, clientName, clientEmail, tatoueurId } = rdvBody;

      // Vérifier si le tatoueur existe
      const artist = await this.prisma.tatoueur.findUnique({
        where: {
          id: tatoueurId,
        },
      });

      if (!artist) {
        return {
          error: true,
          message: 'Tatoueur introuvable.',
        };
      }

      // Mettre à jour le rendez-vous
      const updatedAppointment = await this.prisma.appointment.update({
        where: {
          id,
        },
        data: {
          title,
          prestation,
          start: new Date(start),
          end: new Date(end),
          clientName,
          clientEmail,
          tatoueurId,
        },
      });

      return {
        error: false,
        message: 'Rendez-vous mis à jour avec succès.',
        appointment: updatedAppointment,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR LES RDV PAR TATOUEUR
  async getTatoueurAppointments(tatoueurId: string) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          tatoueurId,
        },
        include: {
          tatoueur: true,
        },
      });
      return appointments;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
