/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAppointmentDto, PrestationType } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ProposeRescheduleDto, ClientRescheduleRequestDto } from './dto/reschedule-appointment.dto';
import { MailService } from 'src/email/mailer.service';
import { FollowupSchedulerService } from 'src/follow-up/followup-scheduler.service';
import { SaasService } from 'src/saas/saas.service';
import * as crypto from 'crypto';
import { CreateAppointmentRequestDto } from './dto/create-appointment-request.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService, 
    private readonly mailService: MailService, 
    private readonly followupSchedulerService: FollowupSchedulerService,
    private readonly saasService: SaasService
  ) {}

  //! ------------------------------------------------------------------------------

  //! CREER UN RDV

  //! ------------------------------------------------------------------------------
  async create({ userId, rdvBody }: {userId: string, rdvBody: CreateAppointmentDto}) {
    try {
      const {  title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, tatoueurId } = rdvBody;

      // 🔒 VÉRIFIER LES LIMITES SAAS - RENDEZ-VOUS PAR MOIS
      const canCreateAppointment = await this.saasService.canPerformAction(userId, 'appointment');
      
      if (!canCreateAppointment) {
        const limits = await this.saasService.checkLimits(userId);
        return {
          error: true,
          message: `Limite de rendez-vous par mois atteinte (${limits.limits.appointments}). Passez au plan PRO ou BUSINESS pour continuer.`,
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
        // 🔒 VÉRIFIER LES LIMITES SAAS - CLIENTS (seulement si on crée un nouveau client)
        const canCreateClient = await this.saasService.canPerformAction(userId, 'client');
        
        if (!canCreateClient) {
          const limits = await this.saasService.checkLimits(userId);
          return {
            error: true,
            message: `Limite de fiches clients atteinte (${limits.limits.clients}). Passez au plan PRO ou BUSINESS pour continuer.`,
          };
        }

        // Étape 2 : Créer le client s'il n'existe pas
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
            status: 'CONFIRMED',
          },
          include: {
            tatoueur: {
              select: {
                name: true
              }
            }
          }
        });

        // Récupérer les informations du salon pour le nom
        const salon = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { salonName: true }
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
            estimatedPrice: rdvBody.estimatedPrice || 0,
            price: rdvBody.price || 0,
          },
        });
        
        try {
          await this.mailService.sendAppointmentConfirmation(
            client.email, 
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                tatoueur: newAppointment.tatoueur?.name || 'Non assigné'
              }
            },
            salon?.salonName || undefined // Passer le nom du salon
          );
          
          console.log('🎯 Email de confirmation PROJET/TATTOO envoyé avec succès !');
        } catch (emailError) {
          console.error('💥 ERREUR lors de l\'envoi de l\'email PROJET/TATTOO:', emailError);
          // Ne pas faire échouer la création du RDV si l'email échoue
        }
      
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
        include: {
          tatoueur: {
            select: {
              name: true
            }
          }
        }
      });

      // Récupérer les informations du salon pour le nom
      const salon = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { salonName: true }
      });
      
      try {
        await this.mailService.sendAppointmentConfirmation(
          client.email, 
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              tatoueur: newAppointment.tatoueur?.name || 'Non assigné'
            }
          },
          salon?.salonName || undefined // Passer le nom du salon
        );
        
        console.log('🎯 Email de confirmation envoyé avec succès !');
      } catch (emailError) {
        console.error('💥 ERREUR lors de l\'envoi de l\'email:', emailError);
        // Ne pas faire échouer la création du RDV si l'email échoue
      }

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

    //! ------------------------------------------------------------------------------

  //! CREER UN RDV PAR UN CLIENT (sans authentification)

  //! ------------------------------------------------------------------------------
  async createByClient({ userId, rdvBody }: {userId: string, rdvBody: CreateAppointmentDto}) {
    console.log(`🔄 Création d'un nouveau rendez-vous pour l'utilisateur ${userId}`);
    try {
      const {  title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, tatoueurId } = rdvBody;

      // 🔒 VÉRIFIER LES LIMITES SAAS - RENDEZ-VOUS PAR MOIS
      const canCreateAppointment = await this.saasService.canPerformAction(userId, 'appointment');
      
      if (!canCreateAppointment) {
        const limits = await this.saasService.checkLimits(userId);
        return {
          error: true,
          message: `Limite de rendez-vous par mois atteinte (${limits.limits.appointments}). Passez au plan PRO ou BUSINESS pour continuer.`,
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
        // 🔒 VÉRIFIER LES LIMITES SAAS - CLIENTS (seulement si on crée un nouveau client)
        const canCreateClient = await this.saasService.canPerformAction(userId, 'client');
        
        if (!canCreateClient) {
          const limits = await this.saasService.checkLimits(userId);
          return {
            error: true,
            message: `Limite de fiches clients atteinte (${limits.limits.clients}). Passez au plan PRO ou BUSINESS pour continuer.`,
          };
        }

        // Étape 2 : Créer le client s'il n'existe pas
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

      // Récupérer les informations du salon pour vérifier addConfirmationEnabled
      const salon = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { addConfirmationEnabled: true, salonName: true, email: true },
      });

      if (!salon) {
        return {
          error: true,
          message: 'Salon introuvable.',
        };
      }

      // Déterminer le statut du rendez-vous selon addConfirmationEnabled
      const appointmentStatus = salon.addConfirmationEnabled ? 'PENDING' : 'CONFIRMED';

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
            status: appointmentStatus,
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
            estimatedPrice: rdvBody.estimatedPrice || 0,
            price: rdvBody.price || 0,
          },
        });

        // Gestion des emails selon le statut
        if (salon.addConfirmationEnabled) {
          // RDV en attente : mail au tatoueur uniquement
          await this.mailService.sendPendingAppointmentNotification(
            salon.email,
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                title: newAppointment.title,
                clientEmail: client.email,
                clientPhone: client.phone
              }
            },
            salon.salonName || undefined
          );
        } else {
          // RDV confirmé : mail au client et au tatoueur
          // Mail au client
          await this.mailService.sendAutoConfirmedAppointment(
            client.email,
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                title: newAppointment.title,
                tatoueur: artist.name
              }
            },
            salon.salonName || undefined
          );

          // Mail au tatoueur
          await this.mailService.sendNewAppointmentNotification(
            salon.email,
            {
              recipientName: `${client.firstName} ${client.lastName}`,
              appointmentDetails: {
                date: newAppointment.start.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                }),
                time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}`,
                service: newAppointment.prestation,
                title: newAppointment.title,
                tatoueur: artist.name,
                clientEmail: client.email,
                clientPhone: client.phone
              }
            },
            salon.salonName || undefined
          );
        }
      
        return {
          error: false,
          message: salon.addConfirmationEnabled 
            ? 'Rendez-vous projet créé en attente de confirmation.' 
            : 'Rendez-vous projet créé avec détail tatouage.',
          appointment: newAppointment,
          tattooDetail,
          status: appointmentStatus,
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
          status: appointmentStatus,
        },
      });

      // Gestion des emails selon le statut
      if (salon.addConfirmationEnabled) {
        // RDV en attente : mail au tatoueur uniquement
        await this.mailService.sendPendingAppointmentNotification(
          salon.email,
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              title: newAppointment.title,
              clientEmail: client.email,
              clientPhone: client.phone
            }
          },
          salon.salonName || undefined
        );
      } else {
        // RDV confirmé : mail au client et au tatoueur
        // Mail au client
        await this.mailService.sendAutoConfirmedAppointment(
          client.email,
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              title: newAppointment.title,
              tatoueur: artist.name
            }
          },
          salon.salonName || undefined
        );

        // Mail au tatoueur
        await this.mailService.sendNewAppointmentNotification(
          salon.email,
          {
            recipientName: `${client.firstName} ${client.lastName}`,
            appointmentDetails: {
              date: newAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${newAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${newAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: newAppointment.prestation,
              title: newAppointment.title,
              tatoueur: artist.name,
              clientEmail: client.email,
              clientPhone: client.phone
            }
          },
          salon.salonName || undefined
        );
      }

      return {
        error: false,
        message: salon.addConfirmationEnabled 
          ? 'Rendez-vous créé en attente de confirmation.' 
          : 'Rendez-vous créé avec succès.',
        appointment: newAppointment,
        status: appointmentStatus,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  } 

  //! ------------------------------------------------------------------------------

  //! VOIR TOUS LES RDV

  //! ------------------------------------------------------------------------------
  async getAllAppointments(id: string) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId: id,
        },
        include: {
          tattooDetail: true,
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
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

  //! ------------------------------------------------------------------------------

  //! VOIR TOUS LES RDV PAR DATE

  //! ------------------------------------------------------------------------------
  async getAppointmentsByDateRange(userId: string, startDate: string, endDate: string, page: number = 1, limit: number = 5) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const skip = (page - 1) * limit;

      // Compter le total des rendez-vous dans la plage de dates
      const totalAppointments = await this.prisma.appointment.count({
        where: {
          userId,
          start: {
            gte: start,
            lt: end,
          },
        },
      });
  
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
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          start: 'desc', // Trier par date décroissante
        },
        skip,
        take: limit,
      });

      const totalPages = Math.ceil(totalAppointments / limit);

      return {
        error: false,
        appointments,
        pagination: {
          currentPage: page,
          totalPages,
          totalAppointments,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR TOUS LES RDV D'UN SALON

  //! ------------------------------------------------------------------------------
  async getAllAppointmentsBySalon(salonId: string, page: number = 1, limit: number = 5) {
    try {
      const skip = (page - 1) * limit;

      // Compter le total des rendez-vous
      const totalAppointments = await this.prisma.appointment.count({
        where: {
          userId: salonId,
        },
      });

      // Récupérer les rendez-vous avec pagination
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId: salonId,
        },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
          tattooDetail: true,
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: {
          start: 'desc', // Trier par date décroissante
        },
        skip,
        take: limit,
      });

      const totalPages = Math.ceil(totalAppointments / limit);

      return {
        error: false,
        appointments,
        pagination: {
          currentPage: page,
          totalPages,
          totalAppointments,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RECUPERER LES RDV D'UN TATOUEUR PAR DATE 

  //! ------------------------------------------------------------------------------
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

  //! ------------------------------------------------------------------------------

  //! VOIR UN SEUL RDV

  //! ------------------------------------------------------------------------------
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

  //! ------------------------------------------------------------------------------

  //! SUPPRIMER UN RDV

  //! ------------------------------------------------------------------------------
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

  //! ------------------------------------------------------------------------------

  // ! MODIFIER UN RDV

  //! ------------------------------------------------------------------------------
  async updateAppointment(id: string, rdvBody: UpdateAppointmentDto) {
    try {
      const { title, prestation, start, end, tatoueurId } = rdvBody;
      const tattooDetail: Partial<UpdateAppointmentDto['tattooDetail']> = rdvBody.tattooDetail || {};
      const { description = '', zone = '', size = '', colorStyle = '', reference = '', sketch = '', estimatedPrice = 0, price = 0 } = tattooDetail;

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
            clientId: existingAppointment.clientId, // ← AJOUT DU clientId manquant
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
        // Récupérer les informations du salon
        const salon = await this.prisma.user.findUnique({
          where: { id: existingAppointment.userId },
          select: { salonName: true }
        });

        await this.mailService.sendAppointmentModification(
          updatedAppointment.client.email,
          {
            recipientName: `${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName}`,
            appointmentDetails: {
              date: updatedAppointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${updatedAppointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${updatedAppointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: updatedAppointment.prestation,
              tatoueur: artist.name
            }
          },
          salon?.salonName || undefined
        );
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

  //! ------------------------------------------------------------------------------

  //! CONFIRMER UN RDV

  //! ------------------------------------------------------------------------------
  async confirmAppointment(id: string, message: string) {
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
          tatoueur: {
            select: {
              name: true,
            },
          },
      },
      });

      //! Si la prestation est TATTOO, RETOUCHE ou PIERCING, planifier un suivi
      //! L'email sera envoyé 5 minutes après la fin du RDV (uniquement si confirmé)
      //! TODO: Rendre ce délai paramétrable (5 jours après la fin du RDV)
      if (
          ['TATTOO', 'RETOUCHE', 'PIERCING'].includes(appointment.prestation)
        ) {
          await this.followupSchedulerService.scheduleFollowup(appointment.id, appointment.end);
        }

      // Envoi d'un mail de confirmation au client (si le client existe)
      if (appointment.client) {
        // Récupérer les informations du salon
        const salon = await this.prisma.user.findUnique({
          where: { id: existingAppointment.userId },
          select: { salonName: true, email: true }
        });

        await this.mailService.sendAppointmentConfirmation(
          appointment.client.email,
          {
            recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
            appointmentDetails: {
              date: appointment.start.toLocaleDateString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }),
              time: `${appointment.start.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })} - ${appointment.end.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}`,
              service: appointment.prestation,
              tatoueur: appointment.tatoueur?.name || 'Non assigné',
              title: appointment.title
            },
            customMessage: message || undefined
          },
          salon?.salonName || undefined,
          salon?.email || undefined
        );
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

  //! ------------------------------------------------------------------------------

  //! ANNULER UN RDV

  //! ------------------------------------------------------------------------------
  async cancelAppointment(id: string, message: string) {
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
    // Récupérer les informations du salon
    const salon = await this.prisma.user.findUnique({
      where: { id: existingAppointment.userId },
      select: { salonName: true, email: true }
    });

    await this.mailService.sendAppointmentCancellation(
      appointment.client.email,
      {
        recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
        appointmentDetails: {
          date: appointment.start.toLocaleDateString('fr-FR', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          }),
          time: `${appointment.start.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })} - ${appointment.end.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`,
          service: appointment.prestation,
          tatoueur: appointment.tatoueur?.name || 'Non assigné',
          title: appointment.title
        },
        customMessage: message || undefined
      },
      salon?.salonName || undefined,
      salon?.email || undefined
    );
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

  //! ------------------------------------------------------------------------------

  //! CHANGER LE STATUT D'UN RDV CONFIRME PASSE À "COMPLETED" OU "NO_SHOW"

  //! ------------------------------------------------------------------------------
  async changeAppointmentStatus(id: string, statusData: 'COMPLETED' | 'NO_SHOW' | { status: 'COMPLETED' | 'NO_SHOW' }) {
    // Extraire le statut si c'est un objet, sinon utiliser directement la valeur
    const status = typeof statusData === 'object' && statusData !== null && 'status' in statusData 
      ? statusData.status 
      : statusData;
    
    console.log(`🔄 Changement du statut du rendez-vous ${id} à ${status}`);
    
    // Validation du statut
    if (!['COMPLETED', 'NO_SHOW'].includes(status)) {
      return {
        error: true,
        message: `Statut invalide: ${status}. Les statuts autorisés sont: COMPLETED, NO_SHOW`,
      };
    }

    try {
      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { status },
        include: {
          tatoueur: true,
          client: true,
          tattooDetail: true,
        },
      });
      return {
        error: false,
        message: `Statut du rendez-vous mis à jour à ${status}.`,
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

  //! ------------------------------------------------------------------------------

  //! ENVOYER UN MAIL PERSONNALISÉ A UN CLIENT 

  //! ------------------------------------------------------------------------------
  async sendCustomEmail(appointmentId: string, subject: string, body: string) {
    try {
      // Récupérer le rendez-vous avec les informations du client et du salon
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          client: true,
          user: {
            select: {
              salonName: true,
              email: true,
            },
          },
        },
      });

      if (!appointment) {
        return {
          error: true,
          message: 'Rendez-vous non trouvé',
        };
      }

      if (!appointment.client) {
        return {
          error: true,
          message: 'Client non trouvé pour ce rendez-vous',
        };
      }

      // Envoyer l'email personnalisé avec le template et le nom du salon
      await this.mailService.sendCustomEmail(
        appointment.client.email,
        subject,
        {
          recipientName: `${appointment.client.firstName} ${appointment.client.lastName}`,
          customMessage: body,
        },
        appointment.user?.salonName || undefined,
        appointment.user?.email || undefined
      );

      return {
        error: false,
        message: 'Email personnalisé envoyé avec succès.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VOIR LES RDV PAR TATOUEUR

  //! ------------------------------------------------------------------------------
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

  //! ------------------------------------------------------------------------------

  //! RENDEZ-VOUS PAYES : Passer isPayed à true

  //! ------------------------------------------------------------------------------
  async markAppointmentAsPaid(id: string, isPayed: boolean) {
    try {

      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { isPayed: isPayed },
        include: {
          tatoueur: true,
          client: true,
          tattooDetail: true,
        },
      });

      return {
        error: false,
        message: `Rendez-vous marqué comme ${isPayed ? 'payé' : 'non payé'}.`,
        appointment: appointment,
      };
    } catch (error: unknown) {
      console.error("❌ Erreur lors de la mise à jour du statut de paiement :", error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  // ! -------------------------------------------------------------------------

  //! DASHBOARD - STATISTIQUES

  // ! --------------------------------------------------------------------------

  //! ------------------------------------------------------------------------------

  //! VOIR LES RDV D'UNE DATE SPÉCIFIQUE POUR DASHBOARD

  //! ------------------------------------------------------------------------------
  /**
   * Récupère les rendez-vous d'une date spécifique pour le dashboard
   * Si aucune date n'est fournie, utilise la date du jour
   * @param userId - ID du salon/utilisateur
   * @param targetDate - Date cible au format string (ex: "2024-08-07") - optionnel
   * @returns Liste des rendez-vous de la date spécifiée
   */
  async getTodaysAppointments(userId: string, targetDate?: string) {
    try {
      // ==================== ÉTAPE 1: DÉTERMINER LA DATE CIBLE ====================
      let selectedDate: Date;
      
      if (targetDate) {
        // Si une date est fournie, l'utiliser
        selectedDate = new Date(targetDate);
        
        // Vérifier si la date est valide
        if (isNaN(selectedDate.getTime())) {
          return {
            error: true,
            message: `Date invalide: ${targetDate}. Format attendu: YYYY-MM-DD`,
          };
        }
      } else {
        // Sinon, utiliser la date du jour
        selectedDate = new Date();
      }

      // ==================== ÉTAPE 2: DÉFINIR LES BORNES DE LA JOURNÉE ====================
      // Début de la journée (00:00:00)
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      // Fin de la journée (début du jour suivant)
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 1);

      // ==================== ÉTAPE 3: RÉCUPÉRER LES RDV DE LA JOURNÉE ====================
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          start: {
            gte: startOfDay, // >= début de la journée
            lt: endOfDay,    // < début du jour suivant
          },
        },
        include: {
          tatoueur: true,
          tattooDetail: true,
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: {
          start: 'asc', // Trier par heure croissante
        },
      });

      // ==================== ÉTAPE 4: FORMATER LA DATE POUR LE RETOUR ====================
      const formattedDate = startOfDay.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      
      // ==================== ÉTAPE 5: RETOUR DES RÉSULTATS ====================
      return {
        error: false,
        appointments,
        selectedDate: startOfDay.toISOString().split('T')[0], // Format YYYY-MM-DD
        formattedDate,
        totalAppointments: appointments.length,
        message: `${appointments.length} rendez-vous trouvé(s) pour le ${formattedDate}`,
      };
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }


  //! ------------------------------------------------------------------------------

  //! TAUX DE REMPLISSAGE DES CRENAUX PAR SEMAINE

  //! ------------------------------------------------------------------------------
  /**
   * Calcule le taux de remplissage des créneaux pour une période donnée
   * @param userId - ID du salon/utilisateur
   * @param startDate - Date de début au format string (ex: "2024-08-01")
   * @param endDate - Date de fin au format string (ex: "2024-08-07")
   * @returns Objet contenant le taux de remplissage et les détails
   */
  async getWeeklyFillRate(userId: string, startDate: string, endDate: string) {
    try {
      // ==================== ÉTAPE 1: VALIDATION DES DATES ====================
      // Convertir les chaînes de caractères en objets Date JavaScript
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Vérifier si la date de début est valide
      // isNaN(date.getTime()) retourne true si la date est invalide
      if (isNaN(start.getTime())) {
        return {
          error: true,
          message: `Date de début invalide: ${startDate}. Format attendu: YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss`,
        };
      }

      // Vérifier si la date de fin est valide
      if (isNaN(end.getTime())) {
        return {
          error: true,
          message: `Date de fin invalide: ${endDate}. Format attendu: YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss`,
        };
      }

      // Vérifier que la logique des dates est correcte (début < fin)
      if (start >= end) {
        return {
          error: true,
          message: 'La date de début doit être antérieure à la date de fin.',
        };
      }

      // ==================== ÉTAPE 2: RÉCUPÉRATION DES RENDEZ-VOUS ====================
      // Chercher tous les rendez-vous du salon dans la période donnée
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId, // Filtrer par salon
          start: { // Filtrer par date de début du rendez-vous
            gte: start, // gte = "greater than or equal" (>= date de début)
            lte: end,   // lte = "less than or equal" (<= date de fin)
          },
        },
      });

      // ==================== ÉTAPE 3: CALCUL DES STATISTIQUES ====================
      // Calculer le nombre total de créneaux disponibles dans la période
      const totalSlots = this.calculateTotalSlots(start, end);
      
      // Compter le nombre de créneaux occupés (= nombre de rendez-vous)
      const filledSlots = appointments.length;

      // ==================== ÉTAPE 4: CALCUL DU TAUX DE REMPLISSAGE ====================
      // Formule: (créneaux occupés / créneaux totaux) * 100
      // Math.round(x * 100) / 100 = arrondir à 2 décimales
      // Exemple: 23 RDV sur 56 créneaux = (23/56)*100 = 41.07%
      const fillRate = totalSlots > 0 
        ? Math.round((filledSlots / totalSlots) * 100 * 100) / 100 
        : 0; // Éviter la division par zéro

      // ==================== ÉTAPE 5: RETOUR DES RÉSULTATS ====================
      return {
        error: false,           // Pas d'erreur
        userId,                 // ID du salon
        startDate,              // Date de début (format original)
        endDate,                // Date de fin (format original)
        totalSlots,             // Nombre total de créneaux disponibles
        filledSlots,            // Nombre de créneaux occupés
        fillRate,               // Taux de remplissage en pourcentage
      };

    } catch (error: unknown) {
      // ==================== GESTION D'ERREURS ====================
      // Si une erreur inattendue survient (problème DB, etc.)
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  /**
   * Calcule le nombre total de créneaux disponibles entre deux dates
   * @param start - Date de début
   * @param end - Date de fin
   * @returns Nombre total de créneaux
   */
  private calculateTotalSlots(start: Date, end: Date): number {
    // ==================== CALCUL DU NOMBRE DE JOURS ====================
    // Différence en millisecondes entre les deux dates
    const timeDifference = end.getTime() - start.getTime();
    
    // Convertir en jours: 1000ms * 60s * 60min * 24h = millisecondes par jour
    // Math.ceil() arrondit vers le haut pour inclure les jours partiels
    const totalDays = Math.ceil(timeDifference / (1000 * 60 * 60 * 24));
    
    // ==================== CALCUL DES CRÉNEAUX ====================
    // Supposons 8 créneaux de 1 heure par jour (10h-18h par exemple)
    // Vous pouvez ajuster ce nombre selon vos horaires d'ouverture
    const slotsPerDay = 8;
    
    // Calcul final: jours × créneaux par jour
    // Math.max(0, ...) assure qu'on ne retourne jamais un nombre négatif
    return Math.max(0, totalDays * slotsPerDay);
  }

  //! ------------------------------------------------------------------------------

  //! TAUX D'ANNULATION GLOBAL DES RDV

  //! ------------------------------------------------------------------------------
  /**
   * Calcule le taux d'annulation global de tous les rendez-vous du salon
   * @param userId - ID du salon/utilisateur
   * @returns Objet contenant le taux d'annulation global et les détails
   */
  async getGlobalCancellationRate(userId: string) {
    try {
      // ==================== ÉTAPE 1: RÉCUPÉRATION DES STATISTIQUES GLOBALES ====================
      // Compter le nombre total de rendez-vous du salon (depuis le début)
      const totalAppointments = await this.prisma.appointment.count({
        where: {
          userId, // Filtrer par salon uniquement
        },
      });

      // Compter le nombre de rendez-vous annulés du salon (depuis le début)
      const cancelledAppointments = await this.prisma.appointment.count({
        where: {
          userId, // Filtrer par salon
          status: 'CANCELED', // Filtrer uniquement les RDV annulés
        },
      });

      // Compter le nombre de rendez-vous confirmés du salon
      const confirmedAppointments = await this.prisma.appointment.count({
        where: {
          userId, // Filtrer par salon
          status: 'CONFIRMED', // Filtrer uniquement les RDV confirmés
        },
      });

      // Compter le nombre de rendez-vous en attente (status par défaut = PENDING)
      const pendingAppointments = await this.prisma.appointment.count({
        where: {
          userId, // Filtrer par salon
          status: 'PENDING', // Uniquement les RDV en attente
        },
      });

      // ==================== ÉTAPE 2: CALCULS ADDITIONNELS ====================
      // Calculer les autres métriques utiles
      const completedAppointments = totalAppointments - cancelledAppointments - pendingAppointments;

      // ==================== ÉTAPE 3: CALCUL DU TAUX D'ANNULATION GLOBAL ====================
      // Formule: (RDV annulés / Total RDV) * 100
      // Exemple: 45 annulés sur 200 total = (45/200)*100 = 22.5%
      const cancellationRate = totalAppointments > 0 
        ? Math.round((cancelledAppointments / totalAppointments) * 100 * 100) / 100 
        : 0; // Éviter la division par zéro

      // Calculer le taux de confirmation
      const confirmationRate = totalAppointments > 0 
        ? Math.round((confirmedAppointments / totalAppointments) * 100 * 100) / 100 
        : 0;

      // ==================== ÉTAPE 4: RETOUR DES RÉSULTATS GLOBAUX ====================
      return {
        error: false,                    // Pas d'erreur
        userId,                          // ID du salon
        totalAppointments,               // Nombre total de RDV depuis le début
        cancelledAppointments,           // Nombre de RDV annulés
        confirmedAppointments,           // Nombre de RDV confirmés
        pendingAppointments,             // Nombre de RDV en attente
        completedAppointments,           // Nombre de RDV réalisés/terminés
        cancellationRate,                // Taux d'annulation global en %
        confirmationRate,                // Taux de confirmation en %
        message: `Statistiques globales du salon calculées avec succès`,
      };

    } catch (error: unknown) {
      // ==================== GESTION D'ERREURS ====================
      // Si une erreur inattendue survient (problème DB, etc.)
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
  //! ------------------------------------------------------------------------------

  //! SOMME DES PRIX DES RDV PAYÉS PAR MOIS

  //! ------------------------------------------------------------------------------
  /**
   * Calcule la somme des prix des rendez-vous payés pour un mois donné
   * Le prix d'un tatouage se trouve dans la table TattooDetails
   * @request userId - ID du salon/utilisateur
   * @param month - Mois (1-12)
   * @param year - Année (ex: 2024)
   * @returns Objet contenant le total des prix des RDV payés
   */
  async getTotalPaidAppointmentsByMonth(userId: string, month: number, year: number) {
    try {
      // ==================== ÉTAPE 1: VALIDATION DES PARAMÈTRES ====================
      // Vérifier que le mois est valide (1-12)
      if (month < 1 || month > 12) {
        return {
          error: true,
          message: 'Mois invalide. Veuillez fournir un mois entre 1 et 12.',
        };
      }

      // ==================== ÉTAPE 2: CALCUL DES DATES DU MOIS ====================
      // Créer les dates de début et de fin du mois
      // month-1 car les mois JavaScript commencent à 0
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1); // Premier jour du mois suivant
      endDate.setHours(0, 0, 0, 0); // Assurer que l'heure est à minuit

      // ==================== ÉTAPE 3: RÉCUPÉRATION DES RDV DU MOIS ====================
      // D'abord, récupérer TOUS les RDV du mois pour debug
      const allAppointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          start: {
            gte: startDate, // >= date de début du mois
            lt: endDate,    // < date de début du mois suivant
          },
        },
        include: {
          tattooDetail: {
            select: {
              price: true,
              estimatedPrice: true,
            },
          },
        },
      });

      // ==================== ÉTAPE 4: FILTRAGE DES RDV PAYÉS ====================
      // Récupérer uniquement les RDV avec Appointment.isPayed = true
      const paidAppointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          isPayed: true, // Seul critère : RDV marqué comme payé dans Appointment
          start: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          tattooDetail: {
            select: {
              price: true,
              estimatedPrice: true,
            },
          },
        },
      });

      // ==================== ÉTAPE 5: CALCUL DU TOTAL ====================
      // Calculer la somme des prix des rendez-vous payés
      let totalPaid = 0;
      let rdvWithPrice = 0;
      let rdvWithoutPrice = 0;

      // Définir le type pour les appointements avec tattooDetail
      type AppointmentWithTattooDetail = {
        id: string;
        tattooDetail?: {
          price?: number | null;
          estimatedPrice?: number | null;
        } | null;
      };

      (paidAppointments as AppointmentWithTattooDetail[]).forEach(appointment => {
        const price = appointment.tattooDetail?.price;
        if (price && typeof price === 'number') {
          totalPaid += price;
          rdvWithPrice++;
        } else {
          rdvWithoutPrice++;
        }
      });

      // ==================== ÉTAPE 6: INFORMATIONS DE DEBUG ====================
      // Compter les RDV par statut pour diagnostic
      const statusCounts = {
        total: allAppointments.length,
        paid: paidAppointments.length,
        unpaid: allAppointments.filter(apt => !apt.isPayed).length,
        withTattooDetail: allAppointments.filter(apt => apt.tattooDetail).length,
        withPrice: allAppointments.filter(apt => apt.tattooDetail?.price && apt.tattooDetail.price > 0).length,
      };

      // ==================== ÉTAPE 7: RETOUR DES RÉSULTATS ====================
      return {
        error: false,
        userId,
        month,
        year,
        totalPaid,                    // Somme totale des prix
        paidAppointmentsCount: paidAppointments.length,  // Nombre de RDV payés
        appointmentsWithPrice: rdvWithPrice,             // RDV payés avec prix
        appointmentsWithoutPrice: rdvWithoutPrice,       // RDV payés sans prix
        debugInfo: statusCounts,      // Infos de debug
        message: `Total des rendez-vous payés pour ${month}/${year}: ${totalPaid}€`,
      };

    } catch (error: unknown) {
      // ==================== GESTION D'ERREURS ====================
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('❌ Erreur dans getTotalPaidAppointmentsByMonth:', errorMessage);
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RDV EN ATTENTE DE CONFIRMATION

  //! ------------------------------------------------------------------------------
  async getPendingAppointments(userId: string) {
    try {
      const pendingAppointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          status: { in: ['PENDING', 'RESCHEDULING'] }, // Filtrer les RDV en attente et en reprogrammation
        },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
          tattooDetail : true,
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: {
          start: 'asc', // Trier par date croissante
        },
      });
      return {
        error: false,
        appointments: pendingAppointments,
        totalAppointments: pendingAppointments.length,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! VALIDER TOKEN DE REPROGRAMMATION

  //! ------------------------------------------------------------------------------
  /**
   * Valide un token de reprogrammation et retourne les informations du rendez-vous
   * Utilisé par le front-end pour afficher la page de sélection de créneaux
   * @param token - Token de reprogrammation à valider
   * @returns Informations du rendez-vous si le token est valide
   */
  async validateRescheduleToken(token: string) {
    try {
      // ==================== ÉTAPE 1: VÉRIFIER LE TOKEN ====================
      const rescheduleRequest = await this.prisma.rescheduleRequest.findFirst({
        where: {
          token,
          status: 'PENDING',
          expiresAt: {
            gte: new Date(), // Token non expiré
          },
        },
        include: {
          appointment: {
            include: {
              client: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                },
              },
              tatoueur: {
                select: {
                  id: true,
                  name: true,
                },
              },
              tattooDetail: {
                select: {
                  description: true,
                  estimatedPrice: true,
                  price: true,
                },
              },
              user: {
                select: {
                  id: true,
                  salonName: true,
                  email: true,
                  phone: true,
                  address: true,
                  city: true,
                },
              },
            },
          },
          newTatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!rescheduleRequest) {
        return {
          error: true,
          message: 'Token invalide, expiré ou demande déjà traitée',
          code: 'INVALID_TOKEN',
        };
      }

      // ==================== ÉTAPE 2: VÉRIFIER QUE LE RDV EXISTE TOUJOURS ====================
      if (!rescheduleRequest.appointment) {
        return {
          error: true,
          message: 'Rendez-vous non trouvé',
          code: 'APPOINTMENT_NOT_FOUND',
        };
      }

      // ==================== ÉTAPE 3: VÉRIFIER QUE LE RDV EST TOUJOURS EN REPROGRAMMATION ====================
      if (rescheduleRequest.appointment.status !== 'RESCHEDULING') {
        return {
          error: true,
          message: 'Ce rendez-vous n\'est plus en cours de reprogrammation',
          code: 'APPOINTMENT_NOT_RESCHEDULING',
        };
      }

      // ==================== ÉTAPE 4: CALCULER LE TEMPS RESTANT ====================
      const now = new Date();
      const expiresAt = new Date(rescheduleRequest.expiresAt);
      const timeRemainingMs = expiresAt.getTime() - now.getTime();
      const timeRemainingHours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
      const timeRemainingDays = Math.floor(timeRemainingHours / 24);

      // ==================== ÉTAPE 5: FORMATER LES INFORMATIONS DU RDV ====================
      const currentAppointmentDate = new Date(rescheduleRequest.appointment.start);
      const currentAppointmentDateStr = currentAppointmentDate.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // ==================== ÉTAPE 6: RETOUR DES INFORMATIONS ====================
      return {
        error: false,
        isValid: true,
        appointmentInfo: {
          id: rescheduleRequest.appointment.id,
          title: rescheduleRequest.appointment.title,
          prestation: rescheduleRequest.appointment.prestation,
          currentDate: currentAppointmentDateStr,
          currentStart: rescheduleRequest.appointment.start,
          currentEnd: rescheduleRequest.appointment.end,
          
          // Informations du client
          client: rescheduleRequest.appointment.client,
          
          // Tatoueur actuel
          currentTatoueur: rescheduleRequest.appointment.tatoueur,
          
          // Nouveau tatoueur (si changement)
          newTatoueur: rescheduleRequest.newTatoueur,
          
          // Détails du tatouage
          tattooDetail: rescheduleRequest.appointment.tattooDetail,
          
          // Informations du salon
          salon: rescheduleRequest.appointment.user,
        },
        rescheduleInfo: {
          token,
          reason: rescheduleRequest.reason,
          requestedAt: rescheduleRequest.createdAt,
          expiresAt: rescheduleRequest.expiresAt,
          timeRemaining: {
            days: timeRemainingDays,
            hours: timeRemainingHours % 24,
            totalHours: timeRemainingHours,
          },
        },
        message: 'Token valide. Vous pouvez choisir vos nouveaux créneaux.',
      };

    } catch (error: unknown) {
      console.error('❌ Erreur lors de la validation du token:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la validation du token: ${errorMessage}`,
        code: 'VALIDATION_ERROR',
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! PROPOSER UNE REPROGRAMMATION DE RDV

  //! ------------------------------------------------------------------------------
  /**
   * Propose une reprogrammation d'un rendez-vous existant
   * Génère un token sécurisé pour que le client puisse confirmer ou refuser
   * @param proposeData - Données de la proposition de reprogrammation
   * @param userId - ID du salon proposant la reprogrammation
   * @returns Résultat de la proposition avec token généré
   */
  async proposeReschedule(proposeData: ProposeRescheduleDto, userId: string) {
    try {
      const { appointmentId, reason, newTatoueurId } = proposeData;

      console.log(reason)

      // ==================== ÉTAPE 1: VÉRIFICATION DU RDV EXISTANT ====================
      const existingAppointment = await this.prisma.appointment.findFirst({
        where: {
          id: appointmentId,
          userId, // S'assurer que le RDV appartient au salon
        },
        include: {
          client: true,
          tatoueur: true,
          tattooDetail: true,
          user: true, // Inclure les infos du salon
        },
      });

      if (!existingAppointment) {
        return {
          error: true,
          message: 'Rendez-vous non trouvé ou non autorisé',
        };
      }

      // Vérifier que le RDV n'est pas déjà annulé
      if (existingAppointment.status === 'CANCELED') {
        return {
          error: true,
          message: 'Impossible de reprogrammer un rendez-vous annulé',
        };
      }

      // ==================== ÉTAPE 2: VÉRIFIER LE NOUVEAU TATOUEUR ====================
      if (newTatoueurId) {
        const newTatoueur = await this.prisma.tatoueur.findFirst({
          where: {
            id: newTatoueurId,
            userId, // S'assurer que le tatoueur appartient au salon
          },
        });

        if (!newTatoueur) {
          return {
            error: true,
            message: 'Nouveau tatoueur non trouvé ou non autorisé',
          };
        }
      }

      // ==================== ÉTAPE 3: GÉNÉRER UN TOKEN SÉCURISÉ ====================
      const rescheduleToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date();
      tokenExpiry.setDate(tokenExpiry.getDate() + 7); // Token valide 7 jours

      // ==================== ÉTAPE 4: CRÉER LA DEMANDE DE REPROGRAMMATION ====================
      await this.prisma.rescheduleRequest.create({
        data: {
          appointmentId,
          token: rescheduleToken,
          reason,
          newTatoueurId,
          expiresAt: tokenExpiry,
          status: 'PENDING',
          createdAt: new Date(),
        },
      });

      // ==================== ÉTAPE 5: MARQUER LE RDV COMME EN ATTENTE DE REPROGRAMMATION ====================
      await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'RESCHEDULING',
          updatedAt: new Date(),
        },
      });

      // ==================== ÉTAPE 6: ENVOYER EMAIL AU CLIENT ====================
      if (!existingAppointment.client) {
        return {
          error: true,
          message: 'Client non trouvé pour ce rendez-vous',
        };
      }

      const clientEmail = existingAppointment.client.email;
      const clientName = `${existingAppointment.client.firstName} ${existingAppointment.client.lastName}`;
      const oldTatoueurName = existingAppointment.tatoueur?.name || 'Non assigné';
      
      // Récupérer le nom du nouveau tatoueur si applicable
      let newTatoueurName = oldTatoueurName;
      if (newTatoueurId) {
        const newTatoueur = await this.prisma.tatoueur.findUnique({
          where: { id: newTatoueurId },
        });
        newTatoueurName = newTatoueur?.name || oldTatoueurName;
      }

      const appointmentDate = new Date(existingAppointment.start);
      const appointmentDateStr = appointmentDate.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // URL pour que le client puisse choisir de nouveaux créneaux
      const rescheduleUrl = `${process.env.FRONTEND_URL}/nouveau-creneau?token=${rescheduleToken}`;

      // Envoyer l'email
      await this.mailService.sendRescheduleProposal(
        clientEmail,
        {
          recipientName: clientName,
          rescheduleDetails: {
            currentDate: appointmentDateStr,
            oldTatoueurName,
            newTatoueurName: newTatoueurId ? newTatoueurName : undefined,
            reason,
            rescheduleUrl,
          }
        },
        existingAppointment.user.salonName || undefined
      );

      // ==================== ÉTAPE 7: RETOUR DU RÉSULTAT ====================
      return {
        error: false,
        message: 'Proposition de reprogrammation envoyée avec succès',
        token: rescheduleToken,
        expiresAt: tokenExpiry,
        appointmentId,
        clientEmail,
        rescheduleUrl,
      };

    } catch (error: unknown) {
      console.error('❌ Erreur lors de la proposition de reprogrammation:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la proposition de reprogrammation: ${errorMessage}`,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! TRAITER LA RÉPONSE CLIENT POUR REPROGRAMMATION

  //! ------------------------------------------------------------------------------
  /**
   * Traite la réponse du client pour une demande de reprogrammation
   * Le client peut proposer de nouveaux créneaux ou refuser la reprogrammation
   * @param rescheduleData - Données de la réponse du client
   * @returns Résultat du traitement de la réponse
   */
  async handleClientRescheduleRequest(rescheduleData: ClientRescheduleRequestDto) {
    try {
      const { token, appointmentId, newStart, newEnd, tatoueurId, clientMessage } = rescheduleData;

      // ==================== ÉTAPE 1: VÉRIFIER LE TOKEN ====================
      const rescheduleRequest = await this.prisma.rescheduleRequest.findFirst({
        where: {
          token,
          appointmentId,
          status: 'PENDING',
          expiresAt: {
            gte: new Date(), // Token non expiré
          },
        },
        include: {
          appointment: {
            include: {
              client: true,
              tatoueur: true,
              tattooDetail: true,
            },
          },
        },
      });

      if (!rescheduleRequest) {
        return {
          error: true,
          message: 'Token invalide, expiré ou demande déjà traitée',
        };
      }

      // ==================== ÉTAPE 2: VÉRIFIER LES NOUVEAUX CRÉNEAUX ====================
      const newStartDate = new Date(newStart);
      const newEndDate = new Date(newEnd);
      const now = new Date();

      // Vérifier que les dates sont dans le futur
      if (newStartDate <= now) {
        return {
          error: true,
          message: 'La nouvelle date de début doit être dans le futur',
        };
      }

      // Vérifier que l'heure de fin est après le début
      if (newEndDate <= newStartDate) {
        return {
          error: true,
          message: 'L\'heure de fin doit être après l\'heure de début',
        };
      }

      // ==================== ÉTAPE 3: VÉRIFIER DISPONIBILITÉ DU TATOUEUR ====================
      // Utiliser notre méthode complète qui vérifie rendez-vous ET créneaux bloqués
      const availabilityCheck = await this.isTimeSlotAvailable(
        newStartDate,
        newEndDate,
        tatoueurId,
        rescheduleRequest.appointment.userId,
        appointmentId // Exclure le rendez-vous actuel de la vérification
      );

      if (!availabilityCheck.available) {
        return {
          error: true,
          message: availabilityCheck.reason || 'Ce créneau n\'est pas disponible.',
        };
      }
      

      // ==================== ÉTAPE 4: METTRE À JOUR LE RDV ====================
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          start: newStartDate,
          end: newEndDate,
          tatoueurId: tatoueurId,
          status: 'CONFIRMED', // Confirmer automatiquement le nouveau créneau
          updatedAt: new Date(),
        },
        include: {
          client: true,
          tatoueur: true,
          tattooDetail: true,
          user: true, // Inclure les infos du salon
        },
      });

      // ==================== ÉTAPE 5: MARQUER LA DEMANDE COMME TRAITÉE ====================
      await this.prisma.rescheduleRequest.update({
        where: { id: rescheduleRequest.id },
        data: {
          status: 'ACCEPTED',
          clientMessage,
          processedAt: new Date(),
        },
      });

      // ==================== ÉTAPE 6: ENVOYER EMAIL DE CONFIRMATION AU CLIENT ====================
      if (!updatedAppointment.client) {
        return {
          error: true,
          message: 'Client non trouvé pour ce rendez-vous',
        };
      }

      const clientEmail = updatedAppointment.client.email;
      const clientName = `${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName}`;
      const tatoueurName = updatedAppointment.tatoueur?.name || 'Non assigné';

      const newAppointmentDate = newStartDate.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // Envoyer l'email de confirmation au client
      await this.mailService.sendRescheduleConfirmation(
        clientEmail,
        {
          recipientName: clientName,
          rescheduleConfirmationDetails: {
            newDate: newAppointmentDate,
            tatoueurName,
            clientMessage,
          }
        },
        updatedAppointment.user?.salonName || undefined
      );

      // ==================== ÉTAPE 7: ENVOYER EMAIL DE NOTIFICATION AU SALON ====================
      // Récupérer les informations du salon pour envoyer la notification
      const salonInfo = await this.prisma.user.findUnique({
        where: { id: rescheduleRequest.appointment.userId },
        select: {
          email: true,
          salonName: true,
        },
      });

      if (salonInfo?.email) {
        const originalAppointmentDate = new Date(rescheduleRequest.appointment.start);
        const originalAppointmentDateStr = originalAppointmentDate.toLocaleDateString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        // Envoyer l'email de notification au salon
        await this.mailService.sendRescheduleAcceptedNotification(
          salonInfo.email,
          {
            rescheduleAcceptedDetails: {
              clientName,
              clientEmail,
              originalDate: originalAppointmentDateStr,
              newDate: newAppointmentDate,
              tatoueurName,
              prestation: updatedAppointment.prestation,
              clientMessage,
            }
          },
          salonInfo.salonName || undefined
        );
      }

      // ==================== ÉTAPE 8: RETOUR DU RÉSULTAT ====================
      return {
        error: false,
        message: 'Rendez-vous reprogrammé avec succès',
        appointment: updatedAppointment,
        newDate: newAppointmentDate,
        clientMessage,
      };

    } catch (error: unknown) {
      console.error('❌ Erreur lors du traitement de la reprogrammation:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors du traitement de la reprogrammation: ${errorMessage}`,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! DEMANDE DE RDV ------------------------------------------------------------------------------

  //! ------------------------------------------------------------------------------

  //! ------------------------------------------------------------------------------

  //! DEMANDE DE RDV

  //! ------------------------------------------------------------------------------
  async createAppointmentRequest(dto: CreateAppointmentRequestDto) {
    console.log('Création d\'une demande de rendez-vous:', dto);

    try {
      const appointmentRequest = await this.prisma.appointmentRequest.create({
        data: {
          userId: dto.userId,
          prestation: dto.prestation, // ✅ passer la valeur
          clientFirstname: dto.clientFirstname,
          clientLastname: dto.clientLastname,
          clientEmail: dto.clientEmail,
          clientPhone: dto.clientPhone ?? null,
          availability: dto.availability, // string (JSON stringifié côté front)
          details: dto.details ?? null,   // string (JSON stringifié côté front)
          message: dto.message ?? null,
          // status: PENDING (par défaut dans le schéma Prisma)
        },
      });
      return {
        error: false,
        message: 'Demande de rendez-vous créée avec succès',
        appointmentRequest,
      };
    } catch (error: unknown) {
      console.error('❌ Erreur lors de la création de la demande de rendez-vous:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la création de la demande de rendez-vous: ${errorMessage}`,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RECUPERER TOUTES LES DEMANDES DE RDV D'UN SALON (TOUS LES STATUS)

  //! ------------------------------------------------------------------------------
  // Filtre serveur par status
  async getAppointmentRequestsBySalon(
    userId: string,
    page: number = 1,
    limit: number = 10,
    status?: string // 👈 nouveau
  ) {
    try {
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      const where: { userId: string; status?: string } = { userId };
      if (status && typeof status === "string" && status.trim() !== "" && status !== "all") {
        where.status = status.trim(); // "PENDING" | "PROPOSED" | ...
      }

      const [totalRequests, appointmentRequests] = await this.prisma.$transaction([
        this.prisma.appointmentRequest.count({ where }),
        this.prisma.appointmentRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: perPage,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalRequests / perPage));
      const startIndex = totalRequests === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + perPage, totalRequests);

      return {
        error: false,
        appointmentRequests,
        pagination: {
          currentPage,
          limit: perPage,
          totalRequests,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
          startIndex,
          endIndex,
        },
      };
    } catch (error: unknown) {
      console.error("❌ Erreur lors de la récupération des demandes de rendez-vous:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      return {
        error: true,
        message: `Erreur lors de la récupération des demandes de rendez-vous: ${errorMessage}`,
      };
    }
  }


  //! ------------------------------------------------------------------------------

  //! RECUPERER LES DEMANDES DE RDV D'UN SALON (tous sauf les CONFIRMER et les CLOSED)

  //! ------------------------------------------------------------------------------
  async getAppointmentRequestsBySalonNotConfirmed(userId: string) {
    try {
      const appointmentRequests = await this.prisma.appointmentRequest.findMany({
        where: {
          userId,
          status: {
            not: {
              in: ['ACCEPTED', 'CLOSED'],
            },
          },
        },
      });

      return {
        error: false,
        appointmentRequests,
      };
    } catch (error: unknown) {
      console.error('❌ Erreur lors de la récupération des demandes de rendez-vous:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la récupération des demandes de rendez-vous: ${errorMessage}`,
      };
    }
  }

  //! ------------------------------------------------------------------------------

  //! RECUPERER LE NOMBRE DE DEMANDE EN ATTENTE

  //! ------------------------------------------------------------------------------
  async getPendingAppointmentRequestsCount(userId: string) {
    try {
      const count = await this.prisma.appointmentRequest.count({
        where: {
          userId,
          status: 'PENDING',
        },
      });
      return {
        error: false,
        count,
      };
    } catch (error: unknown) {
      console.error('❌ Erreur lors de la récupération du nombre de demandes en attente:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la récupération du nombre de demandes en attente: ${errorMessage}`,
      };
    }
  }


  //! ------------------------------------------------------------------------------
    /**
   * Vérification complète de disponibilité d'un créneau
   * Prend en compte les rendez-vous existants ET les créneaux bloqués
   */
  //! ------------------------------------------------------------------------------
  async isTimeSlotAvailable(
    startDate: Date, 
    endDate: Date, 
    tatoueurId: string, 
    userId: string,
    excludeAppointmentId?: string
  ): Promise<{ available: boolean; reason?: string }> {
    try {
      // 1. Vérifier les conflits avec d'autres rendez-vous
      const whereCondition: any = {
        tatoueurId,
        status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULING'] },
        OR: [
          {
            start: { lte: startDate },
            end: { gt: startDate },
          },
          {
            start: { lt: endDate },
            end: { gte: endDate },
          },
          {
            start: { gte: startDate },
            end: { lte: endDate },
          },
        ],
      };

      // Exclure un appointment spécifique si demandé (utile pour la reprogrammation)
      if (excludeAppointmentId) {
        whereCondition.id = { not: excludeAppointmentId };
      }

      const conflictingAppointments = await this.prisma.appointment.findMany({
        where: whereCondition,
      });

      if (conflictingAppointments.length > 0) {
        return {
          available: false,
          reason: 'Le tatoueur a déjà un rendez-vous sur ce créneau.',
        };
      }

      // 2. Vérifier les créneaux bloqués
      const blockedSlots = await this.prisma.blockedTimeSlot.findMany({
        where: {
          userId,
          OR: [
            { tatoueurId: tatoueurId }, // Créneau bloqué pour ce tatoueur spécifique
            { tatoueurId: null }, // Créneau bloqué pour tout le salon
          ],
          AND: [
            {
              startDate: { lt: endDate },
            },
            {
              endDate: { gt: startDate },
            },
          ],
        },
      });

      if (blockedSlots.length > 0) {
        return {
          available: false,
          reason: 'Ce créneau est bloqué.',
        };
      }

      return { available: true };
    } catch (error) {
      console.error('Erreur lors de la vérification de disponibilité:', error);
      return {
        available: false,
        reason: 'Erreur lors de la vérification de disponibilité.',
      };
    }
  }

  // //! ------------------------------------------------------------------------------

  // //! PROPOSER UN CRENEAU POUR UNE DEMANDE DE RDV CLIENT

  // //! ------------------------------------------------------------------------------
  // async proposeSlotForAppointmentRequest(requestId: string, slots: Array<{ from: Date; to: Date; tatoueurId?: string }>, message?: string) {
  //   try {
  //     const appointmentRequest = await this.prisma.appointmentRequest.findUnique({where: { id: requestId }, include: { user: true },});
  //     if (!appointmentRequest) return { error: true, message: 'Demande de RDV introuvable' };
  //     if (!slots?.length) return { error: true, message: 'Aucun créneau fourni' };

  //     // GÉNÉRER UN TOKEN SÉCURISÉ ====================
  //     const proposeToken = crypto.randomBytes(32).toString('hex');
  //     const tokenExpiry = new Date();
  //     tokenExpiry.setDate(tokenExpiry.getDate() + 7); // Le token expire dans 7 jours

  //    // Met à jour la demande + remet à zéro d’anciens slots si tu veux repartir propre
  //     await this.prisma.$transaction(async (tx) => {
  //       await tx.proposedSlot.deleteMany({ where: { appointmentRequestId: requestId } });

  //       await tx.appointmentRequest.update({
  //         where: { id: requestId },
  //         data: {
  //           status: 'PROPOSED',
  //           token: proposeToken,
  //           tokenExpiresAt: tokenExpiry,
  //           updatedAt: new Date(),
  //         },
  //       });

  //       await tx.proposedSlot.createMany({
  //         data: slots.map((s) => ({
  //           appointmentRequestId: requestId,
  //           from: s.from,
  //           to: s.to,
  //           tatoueurId: s.tatoueurId ?? null,
  //         })),
  //       });
  //     });

  //     // Récupère les slots créés (avec leurs IDs)
  //     const createdSlots = await this.prisma.proposedSlot.findMany({
  //       where: { appointmentRequestId: requestId },
  //       orderBy: { createdAt: 'asc' },
  //     });

  //     console.log('Créneaux proposés:', createdSlots);

  //     // Envoi d'un email au client avec les créneaux proposés
  //     const salonName = appointmentRequest.user?.salonName || 'Votre salon';
  //     const clientEmail = appointmentRequest.clientEmail;
  //     const clientName = `${appointmentRequest.clientFirstname} ${appointmentRequest.clientLastname}`;

  //     // Lien d'acceptation/refus (à adapter selon le front)
  //     const proposeUrl = `${process.env.FRONTEND_URL_BIS}/rdv-request?token=${proposeToken}`; 

  //     const emailSubject = `Proposition de créneau pour votre demande de RDV - ${salonName}`;
  //     const emailContent = `
  //       <div style='font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; color: #222; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);'>
  //         <div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;'>
  //           <h1 style='margin: 0; font-size: 24px; color: #fff;'>Proposition de créneau</h1>
  //           <p style='color: #e0e7ff;'>${salonName} vous propose un créneau pour votre demande de rendez-vous en fonction des disponibilités que vous avez indiquées.</p>
  //         </div>
  //           <p style='color: #e0e7ff;'>${message}</p>
  //         <div style='padding: 32px 24px;'>
  //           <p>Bonjour <strong>${clientName}</strong>,</p>
  //           <p>Pour choisir votre créneau ou décliner, merci d’ouvrir la page sécurisée :</p>
  //           <p style="text-align:center;margin:20px 0;">
  //           <a href="${proposeUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0ea5e9;color:#fff;text-decoration:none;font-weight:600;">
  //             Ouvrir la page de confirmation
  //           </a>
  //         </p>
  //           <p style="color:#64748b;font-size:13px;">Ce lien expire le ${tokenExpiry.toLocaleDateString('fr-FR')}.</p>
  //           <p style='color: #64748b; font-size: 14px;'>Si le créneau ne vous convient pas, vous pouvez le décliner et le salon pourra vous proposer un autre horaire.</p>
  //         </div>
  //         <div style='background: #e0e7ff; padding: 16px; text-align: center; border-radius: 0 0 16px 16px;'>
  //           <p style='margin: 0; color: #475569; font-size: 12px;'>© ${new Date().getFullYear()} ${salonName} - Email automatique</p>
  //         </div>
  //       </div>
  //     `;
      
  //     // Envoyer l'email au client
  //     await this.mailService.sendMail({
  //       to: clientEmail,
  //       subject: emailSubject,
  //       html: emailContent,
  //     });

  //     return { error: false, message: 'Créneau proposé au client et email envoyé.' };
  //   } catch (error: unknown) {
  //     return { error: true, message: error instanceof Error ? error.message : 'Erreur inconnue' };
  //   }
  // }

  //   //! VALIDER LE TOKEN DE PROPOSITION DE CRENEAU
  //   async validateAppointmentRequestToken(token: string) {
  //     try {
  //       const appointmentRequest = await this.prisma.appointmentRequest.findFirst({
  //         where: { token },
  //         include: {
  //           user: {
  //             select: {
  //               id: true, email: true, salonName: true, image: true, salonHours: true,
  //               phone: true, address: true, postalCode: true, city: true,
  //             },
  //           },
  //           slots: { select: { id: true, from: true, to: true, tatoueurId: true, status: true } },
  //         },
  //       });

  //       if (!appointmentRequest) {
  //         return { error: true, code: 'INVALID_TOKEN', message: 'Token invalide ou demande introuvable.' };
  //       }
  //       if (appointmentRequest.tokenExpiresAt && appointmentRequest.tokenExpiresAt < new Date()) {
  //         return { error: true, code: 'EXPIRED_TOKEN', message: 'Lien expiré.' };
  //       }
  //       // Optionnel: vérifier expiration si vous stockez une date d'expiration
  //       // Retourner les infos pour affichage sur le front
  //       return {
  //         error: false,
  //         appointmentRequest: {
  //           id: appointmentRequest.id,
  //           prestation: appointmentRequest.prestation,
  //           clientFirstname: appointmentRequest.clientFirstname,
  //           clientLastname: appointmentRequest.clientLastname,
  //           clientEmail: appointmentRequest.clientEmail,
  //           clientPhone: appointmentRequest.clientPhone,
  //           availability: appointmentRequest.availability,
  //           details: appointmentRequest.details,
  //           status: appointmentRequest.status,
  //           message: appointmentRequest.message,
  //           salonName: appointmentRequest.user?.salonName,
  //           salonEmail: appointmentRequest.user?.email,
  //           salonImage: appointmentRequest.user?.image,
  //           salonHours: appointmentRequest.user?.salonHours,
  //           salonPhone: appointmentRequest.user?.phone,
  //           salonAddress: appointmentRequest.user?.address,
  //           salonPostalCode: appointmentRequest.user?.postalCode,
  //           salonCity: appointmentRequest.user?.city,

  //           // <-- nouveau : tous les créneaux proposés
  //           proposedSlots: appointmentRequest.slots.map(s => ({
  //             id: s.id,
  //             from: s.from,
  //             to: s.to,
  //             tatoueurId: s.tatoueurId,
  //             status: s.status,
  //           })),
  //         },
  //       };
  //     } catch (error: unknown) {
  //       return { error: true, message: error instanceof Error ? error.message : 'Erreur inconnue' };
  //     }
  //   }

  //   //! ------------------------------------------------------------------------------

  //   //! TRAITER LA REPONSE DU CLIENT (ACCEPTER OU DECLINER)

  //   //! ------------------------------------------------------------------------------
  //   async handleAppointmentRequestResponse(token: string, action: 'accept' | 'decline', slotId?: string, reason?: string) {
  //     try {
  //       const appointmentRequest = await this.prisma.appointmentRequest.findFirst({
  //         where: { token },
  //         include: { user: { select: { id: true, email: true, salonName: true } } },
  //       });

  //       if (!appointmentRequest) {
  //         return { error: true, message: 'Token invalide ou demande introuvable.' };
  //       }

  //       if (appointmentRequest.status !== 'PROPOSED') {
  //         return { error: true, message: 'La demande n\'est pas en attente de réponse.' };
  //       }

  //       if (appointmentRequest.tokenExpiresAt && appointmentRequest.tokenExpiresAt < new Date())
  //       return { error: true, message: 'Lien expiré.' };

  //       const userId = appointmentRequest.userId;
  //       const salonEmail = appointmentRequest.user?.email;
  //       const salonName = appointmentRequest.user?.salonName || 'Salon';
  //       const clientName = `${appointmentRequest.clientFirstname} ${appointmentRequest.clientLastname}`;
        
  //       if (action === 'accept') {
  //         if (!slotId) return { error: true, message: 'slotId manquant pour acceptation.' };

  //         const slot = await this.prisma.proposedSlot.findFirst({
  //           where: { id: slotId, appointmentRequestId: appointmentRequest.id },
  //         });
  //         if (!slot) return { error: true, message: 'Créneau introuvable.' };


  //         await this.prisma.appointmentRequest.update({
  //           where: { id: appointmentRequest.id },
  //           data: { status: 'ACCEPTED', updatedAt: new Date() },
  //         });

  //         // vérifier collision sur le tatoueur
  //         if (slot.tatoueurId) {
  //           const overlap = await this.prisma.appointment.findFirst({
  //             where: {
  //               tatoueurId: slot.tatoueurId,
  //               // [start,end) overlap
  //               NOT: [{ end: { lte: slot.from } }, { start: { gte: slot.to } }],
  //             },
  //             select: { id: true },
  //           });
  //           if (overlap) return { error: true, message: 'Ce créneau n\'est plus disponible.' };
  //         }

  //         //! Créer directement le rdv, le client et les détails tatouage client
  //         // Vérifier les limites SAAS - RDV Par mois
  //         const canCreateAppointment = await this.saasService.canPerformAction(userId, 'appointment');

  //         if (!canCreateAppointment) {
  //           const limits = await this.saasService.checkLimits(userId);
  //           return {
  //             error: true,
  //             message: `Limite de rendez-vous par mois atteinte (${limits.limits.appointments}). Passez au plan PRO ou BUSINESS pour continuer.`,
  //           };
  //         }

  //         // Vérifier si le client existe déja sinon on le créé
  //         let client = await this.prisma.client.findFirst({
  //           where: { email: appointmentRequest.clientEmail, userId },
  //         });

  //         if (!client) {
  //           const canCreateClient = await this.saasService.canPerformAction(userId, 'client');
        
  //           if (!canCreateClient) {
  //             const limits = await this.saasService.checkLimits(userId);
  //             return {
  //               error: true,
  //               message: `Limite de fiches clients atteinte (${limits.limits.clients}). Passez au plan PRO ou BUSINESS pour continuer.`,
  //             };
  //           }

  //           client = await this.prisma.client.create({
  //             data: {
  //               firstName: appointmentRequest.clientFirstname,
  //               lastName: appointmentRequest.clientLastname,
  //               email: appointmentRequest.clientEmail,
  //               phone: appointmentRequest.clientPhone || '',
  //               userId,
  //             },
  //           });
  //         }


  //        // Transaction : créer RDV + marquer le slot choisi + invalider le token
  //         const newAppointment = await this.prisma.$transaction(async (tx) => {
  //           const appt = await tx.appointment.create({
  //             data: {
  //               userId,
  //               title: appointmentRequest.prestation,
  //               prestation: appointmentRequest.prestation,
  //               start: slot.from,
  //               end: slot.to,
  //               tatoueurId: slot.tatoueurId ?? appointmentRequest.tatoueurId ?? null,
  //               clientId: client.id,
  //               status: 'CONFIRMED',
  //             },
  //           });

  //           await tx.proposedSlot.update({
  //             where: { id: slot.id },
  //             data: { status: 'ACCEPTED', selectedAt: new Date() },
  //           });
  //           await tx.proposedSlot.updateMany({
  //             where: { appointmentRequestId: appointmentRequest.id, NOT: { id: slot.id } },
  //             data: { status: 'DECLINED' },
  //           });
  //           await tx.appointmentRequest.update({
  //             where: { id: appointmentRequest.id },
  //             data: { status: 'ACCEPTED', token: null, tokenExpiresAt: null, updatedAt: new Date() },
  //           });

  //           // Détails tatouage éventuels
  //           if (appointmentRequest.details) {
  //             try {
  //               const raw = typeof appointmentRequest.details === 'string'
  //                 ? JSON.parse(appointmentRequest.details)
  //                 : appointmentRequest.details;

  //               await tx.tattooDetail.create({
  //                 data: {
  //                   appointmentId: appt.id,
  //                   clientId: client.id,
  //                   description: String(raw.description ?? ''),
  //                   zone: String(raw.zone ?? null),
  //                   size: String(raw.size ?? null),
  //                   colorStyle: String(raw.colorStyle ?? null),
  //                   sketch: String(raw.sketch ?? null),
  //                   reference: String(raw.reference ?? null),
  //                 },
  //               });
  //             } catch {/* ignore */}
  //           }

  //           return appt;
  //         });

  //         // Email au salon
  //         if (salonEmail) {
  //           const emailSubject = `Le client a accepté le créneau proposé - ${clientName}`;
  //           const emailContent = `
  //             <div style='font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; color: #222; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);'>
  //               <div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;'>
  //                 <h1 style='margin: 0; font-size: 24px; color: #fff;'>Créneau accepté</h1>
  //                 <p style='color: #d1fae5;'>${clientName} a accepté le créneau proposé.</p>
  //               </div>
  //               <div style='padding: 32px 24px;'>
  //                 <p>Créneau accepté :</p>
  //                 <ul style='background: #d1fae5; padding: 16px; border-radius: 8px;'>
  //                   <li><strong>De :</strong> ${newAppointment.start.toLocaleString()}</li>
  //                   <li><strong>À :</strong> ${newAppointment.end.toLocaleString()}</li>
  //                 </ul>
  //                 <p style='color: #64748b; font-size: 14px;'>Vous pouvez maintenant créer le rendez-vous dans votre planning.</p>
  //               </div>
  //               <div style='background: #e0e7ff; padding: 16px; text-align: center; border-radius: 0 0 16px 16px;'>
  //                 <p style='margin: 0; color: #475569; font-size: 12px;'>© ${new Date().getFullYear()} ${salonName} - Notification automatique</p>
  //               </div>
  //             </div>
  //           `;

  //           await this.mailService.sendMail({
  //             to: salonEmail,
  //             subject: emailSubject,
  //             html: emailContent,
  //           });

  //             // Envoi du mail de confirmation
  //           await this.mailService.sendMail({
  //             to: client.email,
  //             subject: "Rendez-vous confirmé",
  //             html: `
  //               <h2>Bonjour ${client.firstName} ${client.lastName} !</h2>
  //               <p>Votre rendez-vous a été confirmé avec succès.</p>
  //               <p><strong>Détails du rendez-vous :</strong></p>
  //               <ul>
  //                 <li>Date et heure : ${newAppointment.start.toLocaleString()} - ${newAppointment.end.toLocaleString()}</li>
  //                 <li>Prestation : ${newAppointment.prestation}</li>
  //               </ul>
  //               <p>Nous avons hâte de vous voir !</p>
  //               <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
  //               <p>À bientôt !</p>
  //             `,
  //           });
  //         }

  //         return { error: false, message: 'Demande acceptée, salon notifié.' };
  //       } else if (action === 'decline') {
  //         await this.prisma.$transaction(async (tx) => {
  //           await tx.proposedSlot.updateMany({
  //             where: { appointmentRequestId: appointmentRequest.id },
  //             data: { status: 'DECLINED' },
  //           });
  //           await tx.appointmentRequest.update({
  //             where: { id: appointmentRequest.id },
  //             data: {
  //               status: 'DECLINED',
  //               message: reason ?? appointmentRequest.message,
  //               token: null,
  //               tokenExpiresAt: null,
  //               updatedAt: new Date(),
  //             },
  //           });
  //         });
  //         // Email au salon
  //         if (salonEmail) {
  //           const emailSubject = `Le client a décliné le créneau proposé - ${clientName}`;
  //           const emailContent = `
  //             <div style='font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; color: #222; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);'>
  //               <div style='background: linear-gradient(135deg, #ef4444 0%, #f59e42 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;'>
  //                 <h1 style='margin: 0; font-size: 24px; color: #fff;'>Créneau décliné</h1>
  //                 <p style='color: #fee2e2;'>${clientName} a décliné le créneau proposé.</p>
  //               </div>
  //               <div style='padding: 32px 24px;'>
  //                 <p style='color: #64748b; font-size: 14px;'>Vous pouvez proposer un autre créneau ou clôturer la demande.</p>
  //                 ${reason ? `<div style='margin-top:16px; color:#ef4444;'><strong>Motif du client :</strong> ${reason}</div>` : ''}
  //               </div>
  //               <div style='background: #e0e7ff; padding: 16px; text-align: center; border-radius: 0 0 16px 16px;'>
  //                 <p style='margin: 0; color: #475569; font-size: 12px;'>© ${new Date().getFullYear()} ${salonName} - Notification automatique</p>
  //               </div>
  //             </div>
  //           `;
  //           await this.mailService.sendMail({
  //             to: salonEmail,
  //             subject: emailSubject,
  //             html: emailContent,
  //           });
  //         }
  //         return { error: false, message: 'Créneau refusé par le client, salon notifié.' };
  //       } else {
  //         return { error: true, message: 'Action non reconnue.' };
  //       }
  //     } catch (error: unknown) {
  //       return { error: true, message: error instanceof Error ? error.message : 'Erreur inconnue' };
  //     }
  //   }

  //   //! ------------------------------------------------------------------------------

  //   //! SALON : REFUSER LA DEMANDE DE RDV D'UN CLIENT

  //   //! ------------------------------------------------------------------------------
  //   async declineAppointmentRequest(appointmentRequestId: string, reason?: string): Promise<{ error: boolean; message: string }> {
  //     try {
  //       const appointmentRequest = await this.prisma.appointmentRequest.findUnique({
  //         where: { id: appointmentRequestId },
  //         include: { user: true }
  //       });

  //       if (!appointmentRequest) {
  //         return { error: true, message: 'Demande de rendez-vous introuvable.' };
  //       }

  //       const clientEmail = appointmentRequest.clientEmail;
  //       const clientName = `${appointmentRequest.clientFirstname} ${appointmentRequest.clientLastname}`;
  //       const salonName = appointmentRequest.user?.salonName || 'Votre salon';

  //       await this.prisma.appointmentRequest.update({
  //         where: { id: appointmentRequest.id },
  //         data: { status: 'CLOSED', updatedAt: new Date()},
  //       });

  //       // Email au client
  //       if (clientEmail) {
  //         const emailSubject = `Votre demande de rendez-vous a été refusée - ${salonName}`;
  //         const emailContent = `
  //           <div style='font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; color: #222; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);'>
  //             <div style='background: linear-gradient(135deg, #ef4444 0%, #f59e42 100%); padding: 32px 24px; text-align: center; border-radius: 16px 16px 0 0;'>
  //               <h1 style='margin: 0; font-size: 24px; color: #fff;'>Demande de rendez-vous refusée</h1>
  //               <p style='color: #fee2e2;'>Votre demande de rendez-vous a été refusée par le salon.</p>
  //             </div>
  //             <div style='padding: 32px 24px;'>
  //               <p>Motif du refus :</p>
  //               <ul style='background: #fee2e2; padding: 16px; border-radius: 8px;'>
  //                 <li><strong>Client :</strong> ${clientName}</li>
  //                 <li><strong>Salon :</strong> ${salonName}</li>
  //                 <li><strong>Motif :</strong> ${reason ?? 'Aucun motif fourni'}</li>
  //               </ul>
  //               <p style='color: #64748b; font-size: 14px;'>Vous pouvez proposer un autre créneau ou clôturer la demande.</p>
  //             </div>
  //             <div style='background: #e0e7ff; padding: 16px; text-align: center; border-radius: 0 0 16px 16px;'>
  //               <p style='margin: 0; color: #475569; font-size: 12px;'>© ${new Date().getFullYear()} ${salonName} - Notification automatique</p>
  //             </div>
  //           </div>
  //         `;
  //         await this.mailService.sendMail({
  //           to: clientEmail,
  //           subject: emailSubject,
  //           html: emailContent,
  //         });
  //       }

  //       return { error: false, message: 'Demande de rendez-vous refusée, client notifié.' };
  //     } catch (error: unknown) {
  //       return { error: true, message: error instanceof Error ? error.message : 'Erreur inconnue' };
  //     }
  //   }



  // //! ------------------------------------------------------------------------------

  // //! MÉTHODE DE TEST POUR L'ENVOI D'EMAILS

  // //! ------------------------------------------------------------------------------
  // async testEmailSending(email: string) {
  //   try {
  //     console.log('🧪 Test d\'envoi d\'email vers:', email);
      
  //     // Test 1: Email basique
  //     console.log('📤 Test 1: Email basique...');
  //     await this.mailService.sendMail({
  //       to: email,
  //       subject: '🧪 Test Email Basique - Salon Test',
  //       html: '<h1>Test réussi !</h1><p>Si vous recevez cet email, la configuration de base fonctionne.</p>',
  //       salonName: 'Salon Test'
  //     });

  //     // Test 2: Email avec template
  //     console.log('📤 Test 2: Email avec template...');
  //     await this.mailService.sendAppointmentConfirmation(
  //       email, 
  //       {
  //         recipientName: 'Test User',
  //         appointmentDetails: {
  //           date: 'Lundi 10 septembre 2025',
  //           time: '14:00 - 16:00',
  //           service: 'Test Service',
  //           tatoueur: 'Test Artist',
  //           price: 150
  //         }
  //       },
  //       'Salon Test' // Nom du salon de test
  //     );

  //     return {
  //       error: false,
  //       message: 'Tests d\'email envoyés avec succès ! Vérifiez votre boîte de réception.',
  //       tests: [
  //         'Email basique envoyé',
  //         'Email avec template envoyé'
  //       ]
  //     };
  //   } catch (error) {
  //     console.error('💥 Erreur lors du test d\'email:', error);
  //     return {
  //       error: true,
  //       message: `Erreur lors du test: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
  //       details: error
  //     };
  //   }
  // }
}