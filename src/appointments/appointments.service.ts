/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAppointmentDto, PrestationType } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { MailService } from 'src/mailer.service';


@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService, private readonly mailService: MailService) {}

  //! CREER UN RDV
 async create({ rdvBody }: {rdvBody: CreateAppointmentDto}) {
  console.log("🧾 Payload reçu :", rdvBody);
   try {
      const { userId, title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, tatoueurId } = rdvBody;

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
          OR: [
            {
              start: { lt: new Date(end) },
              end: { gt: new Date(start) },
            },
          ],
        },
      });

      if (existingAppointment) {
        return {
          error: true,
          message: 'Ce créneau horaire est déjà réservé.',
        };
      }

      let client = await this.prisma.client.findFirst({
        where: {
          email: clientEmail,
          userId: userId, // Pour que chaque salon ait ses propres clients
        },
      });

      if (!client) {
        // Étape 2 : Créer le client s’il n’existe pas
        client = await this.prisma.client.create({
          data: {
            firstName: clientFirstname,
            lastName: clientLastname,
            email: clientEmail,
            phone: clientPhone || "",
            userId,
          },
        });
      }

      if (prestation === PrestationType.PROJET || prestation === PrestationType.TATTOO || prestation === PrestationType.PIERCING || prestation === PrestationType.RETOUCHE) {
        const newAppointment = await this.prisma.appointment.create({
          data: {
            userId,
            title,
            prestation,
            start: new Date(start),
            end: new Date(end),
            tatoueurId,
            clientId: client.id,
          },
        });
      
        const tattooDetail = await this.prisma.tattooDetail.create({
          data: {
            appointmentId: newAppointment.id,
            clientId: client.id,
            description: rdvBody.description || '',
            zone: rdvBody.zone || '',
            size: rdvBody.size || '',
            colorStyle: rdvBody.colorStyle || '',
            reference: rdvBody.reference,
            sketch: rdvBody.sketch,
            estimatedPrice: rdvBody.estimatedPrice || 0, // Prix par défaut à 0 pour un projet
            price: rdvBody.price || 0, // Prix par défaut à 0 pour un projet
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
          userId,
          title,
          prestation,
          start: new Date(start),
          end: new Date(end),
          tatoueurId,
          clientId: client.id,
        },
      });

      // Envoi du mail de confirmation
      await this.mailService.sendMail({
          to: client.email,
          subject: "Confirmez votre adresse email",
          html: `
            <h2>Bonjour ${client.firstName} ${client.lastName} !</h2>
            <p>Votre demande de rendez-vous a été reçue.</p>
            <p>Vous allez recevoir une confirmation très bientôt.</p>
            <p>Merci de votre confiance !</p>
            <p>Date et heure du rendez-vous : ${newAppointment.start.toLocaleString()}</p>
            <p>Nom du tatoueur : ${artist.name}</p>
            <p>Prestation : ${newAppointment.prestation}</p>
            <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
            <p>À bientôt !</p>
            <p>Nom du salon</p>
          `,
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
  async getAllAppointments(id: string) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId: id,
        },
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

  //! VOIR TOUS LES RDV PAR DATE
  async getAppointmentsByDateRange(userId: string, startDate: string, endDate: string) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
  
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          start: {
            gte: start,
            lt: end,
          },
        },
        include: {
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          tattooDetail: true,
          tatoueur: true,
        },
      });

      return appointments ?? []; 
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! RECUPERER LES RDV D'UN TATOUEUR PAR DATE 
  async getAppointmentsByTatoueurRange(tatoueurId: string, startDate: string, endDate: string) {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        tatoueurId,
        start: {
          gte: start,
          lt: end,
        },
      },
      select: {
        start: true,
        end: true,
      },
    });

    return appointments ?? [];
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
  async updateAppointment(id: string, rdvBody: UpdateAppointmentDto) {
    try {
      const { title, prestation, start, end, tatoueurId } = rdvBody;
      const tattooDetail: Partial<UpdateAppointmentDto['tattooDetail']> = rdvBody.tattooDetail || {};
      const { description = '', zone = '', size = '', colorStyle = '', reference = '', sketch = '', estimatedPrice = 0, price = 0 } = tattooDetail;
      console.log("🧾 Payload reçu :", rdvBody);

      // Récupérer le rendez-vous existant avec les informations du client
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id },
        include: {
          client: true,
          tatoueur: true,
        },
      });

      if (!existingAppointment) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.',
        };
      }

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
          tatoueurId,
        },
        include: {
        client: true,
        tatoueur: true,
      },
      });

      // Mettre à jour les détails du tatouage s'ils existent
      if (tattooDetail) {
        await this.prisma.tattooDetail.upsert({
          where: { appointmentId: id },
          update: {
            description,
            zone,
            size,
            colorStyle,
            reference,
            sketch,
            estimatedPrice,
            price,
          },
          create: {
            appointmentId: id,
            description,
            zone,
            size,
            colorStyle,
            reference,
            sketch,
            estimatedPrice,
            price,
          },
        });
      }

      // Vérifier si les horaires ont changé
      const originalStart = existingAppointment.start.toISOString();
      const originalEnd = existingAppointment.end.toISOString();
      const newStart = new Date(start).toISOString();
      const newEnd = new Date(end).toISOString();

      // Envoi d'un mail de confirmation si les horaires ont changé
      if ((originalStart !== newStart || originalEnd !== newEnd) && updatedAppointment.client) {
        await this.mailService.sendMail({
          to: updatedAppointment.client.email,
          subject: "Rendez-vous modifié",
          html: `
            <h2>Bonjour ${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName} !</h2>
            <p>Votre rendez-vous a été modifié.</p>
            <p>Nouvelle date et heure : ${updatedAppointment.start.toLocaleString()} - ${updatedAppointment.end.toLocaleString()}</p>
            <p>Nom du tatoueur : ${artist.name}</p>
            <p>Prestation : ${updatedAppointment.prestation}</p>
            <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
            <p>À bientôt !</p>
          `,
        });
      }

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

  //! CONFIRMER UN RDV
  async confirmAppointment(id: string) {
    try {
    // Récupérer le rendez-vous avec les informations du client et du tatoueur
    const existingAppointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        client: true,
        tatoueur: true,
      },
    });

    if (!existingAppointment) {
      return {
        error: true,
        message: 'Rendez-vous introuvable.',
      };
    }

      const appointment = await this.prisma.appointment.update({
        where: {
          id,
        },
        data: {
          status: 'CONFIRMED',
        },
        include: {
          client: true,
          tatoueur: true,
      },
      });

      if (appointment.client) {
        await this.mailService.sendMail({
          to: appointment.client.email,
          subject: "Rendez-vous confirmé",
          html: `
            <h2>Bonjour ${appointment.client.firstName} ${appointment.client.lastName} !</h2>
            <p>Votre rendez-vous a été confirmé avec succès.</p>
            <p><strong>Détails du rendez-vous :</strong></p>
            <ul>
              <li>Date et heure : ${appointment.start.toLocaleString()} - ${appointment.end.toLocaleString()}</li>
              <li>Prestation : ${appointment.prestation}</li>
              <li>Tatoueur : ${appointment.tatoueur?.name || 'Non assigné'}</li>
              <li>Titre : ${appointment.title}</li>
            </ul>
            <p>Nous avons hâte de vous voir !</p>
            <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
            <p>À bientôt !</p>
          `,
        });
    }

      return {
        error: false,
        message: 'Rendez-vous confirmé.',
        appointment: appointment,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

    //! ANNULER UN RDV
    async cancelAppointment(id: string) {
      try {
        const existingAppointment = await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            client: true,
            tatoueur: true,
          },
        });

    if (!existingAppointment) {
      return {
        error: true,
        message: 'Rendez-vous introuvable.',
      };
    }

    const appointment = await this.prisma.appointment.update({
      where: {
        id,
      },
      data: {
        status: 'CANCELED',
      },
      include: {
        client: true,
        tatoueur: true,
      },
    });

            // Envoyer un email d'annulation au client (si le client existe)
    if (appointment.client) {
      await this.mailService.sendMail({
        to: appointment.client.email,
        subject: "Rendez-vous annulé",
        html: `
          <h2>Bonjour ${appointment.client.firstName} ${appointment.client.lastName} !</h2>
          <p>Nous sommes désolés de vous informer que votre rendez-vous a été annulé.</p>
          <p><strong>Détails du rendez-vous annulé :</strong></p>
          <ul>
            <li>Date et heure : ${appointment.start.toLocaleString()} - ${appointment.end.toLocaleString()}</li>
            <li>Prestation : ${appointment.prestation}</li>
            <li>Tatoueur : ${appointment.tatoueur?.name || 'Non assigné'}</li>
            <li>Titre : ${appointment.title}</li>
          </ul>
          <p>N'hésitez pas à nous contacter pour reprogrammer votre rendez-vous ou pour toute question.</p>
          <p>Nous nous excusons pour la gêne occasionnée.</p>
          <p>Cordialement,</p>
          <p>L'équipe du salon</p>
        `,
      });
    }

        return {
          error: false,
          message: 'Rendez-vous annulé.',
          appointment: appointment,
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
