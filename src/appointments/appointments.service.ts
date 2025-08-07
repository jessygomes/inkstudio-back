import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAppointmentDto, PrestationType } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ProposeRescheduleDto, ClientRescheduleRequestDto } from './dto/reschedule-appointment.dto';
import { MailService } from 'src/mailer.service';
import { FollowupSchedulerService } from 'src/follow-up/followup-scheduler.service';
import { SaasService } from 'src/saas/saas.service';
import * as crypto from 'crypto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService, 
    private readonly mailService: MailService, 
    private readonly followupSchedulerService: FollowupSchedulerService,
    private readonly saasService: SaasService
  ) {}

  //! CREER UN RDV
  async create({ rdvBody }: {rdvBody: CreateAppointmentDto}) {
    console.log(`🔄 Création d'un nouveau rendez-vous pour l'utilisateur ${rdvBody.userId}`);
    try {
      const { userId, title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, tatoueurId } = rdvBody;

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
            estimatedPrice: rdvBody.estimatedPrice || 0,
            price: rdvBody.price || 0,
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

  //! VOIR TOUS LES RDV PAR DATE
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

  //! VOIR TOUS LES RDV D'UN SALON
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
      if (
          ['TATTOO', 'RETOUCHE', 'PIERCING'].includes(appointment.prestation)
        ) {
          console.log(`📅 Planification du suivi pour le RDV ${appointment.id}`);
          await this.followupSchedulerService.scheduleFollowup(appointment.id, appointment.end);
        }

        console.log(`✅ Rendez-vous ${appointment.id} confirmé avec succès`);

      // Envoi d'un mail de confirmation au client (si le client existe)
      if (appointment.client) {
        await this.mailService.sendMail({
          to: appointment.client.email,
          subject: "Rendez-vous confirmé",
          html: `
            <h2>Bonjour ${appointment.client.firstName} ${appointment.client.lastName} !</h2>
            <p>Votre rendez-vous a été confirmé avec succès.</p>
            <p>${message}</p>
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
      await this.mailService.sendMail({
        to: appointment.client.email,
        subject: "Rendez-vous annulé",
        html: `
          <h2>Bonjour ${appointment.client.firstName} ${appointment.client.lastName} !</h2>
          <p>Nous sommes désolés de vous informer que votre rendez-vous a été annulé.</p>
          <p>${message}</p>
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

  //! RENDEZ-VOUS PAYES : Passer isPayed à true
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

  //! VOIR LES RDV D'UNE DATE SPÉCIFIQUE POUR DASHBOARD
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


  //! TAUX DE REMPLISSAGE DES CRENAUX PAR SEMAINE
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

  //! TAUX D'ANNULATION GLOBAL DES RDV
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

  //! SOMME DES PRIX DES RDV PAYÉS PAR MOIS
  /**
   * Calcule la somme des prix des rendez-vous payés pour un mois donné
   * Le prix d'un tatouage se trouve dans la table TattooDetails
   * @param userId - ID du salon/utilisateur
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

  //! RDV EN ATTENTE DE CONFIRMATION
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
          tattooDetail: {
            select: {
              description: true,
              estimatedPrice: true,
              price: true,
            },
          },
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

  //! VALIDER TOKEN DE REPROGRAMMATION
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

  //! PROPOSER UNE REPROGRAMMATION DE RDV
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

      const emailSubject = '🔄 Reprogrammation de votre rendez-vous - Action requise';
      const emailContent = `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              🔄 Reprogrammation Nécessaire
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 16px; color: rgba(255,255,255,0.9);">
              Votre rendez-vous doit être reprogrammé
            </p>
          </div>

          <!-- Content -->
          <div style="padding: 32px 24px;">
            <p style="font-size: 18px; margin: 0 0 24px 0; color: #f1f5f9;">
              Bonjour <strong style="color: #60a5fa;">${clientName}</strong>,
            </p>

            <div style="background: rgba(99, 102, 241, 0.1); border-left: 4px solid #6366f1; padding: 20px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0 0 16px 0; color: #f1f5f9; font-size: 16px;">
                Nous devons reprogrammer votre rendez-vous :
              </p>
              <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px;">
                <p style="margin: 0 0 8px 0; color: #cbd5e1;"><strong>📅 Date actuelle :</strong> ${appointmentDateStr}</p>
                <p style="margin: 0 0 8px 0; color: #cbd5e1;"><strong>👨‍🎨 Tatoueur :</strong> ${oldTatoueurName}</p>
                ${newTatoueurId ? `<p style="margin: 0; color: #60a5fa;"><strong>👨‍🎨 Nouveau tatoueur :</strong> ${newTatoueurName}</p>` : ''}
              </div>
            </div>

            ${reason ? `
              <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #f59e0b; font-weight: 600;">Motif :</p>
                <p style="margin: 0; color: #e2e8f0; font-style: italic;">${reason}</p>
              </div>
            ` : ''}

            <div style="text-align: center; margin: 32px 0;">
              <a href="${rescheduleUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3); transition: transform 0.2s;">
                📅 Choisir de nouveaux créneaux
              </a>
            </div>

            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0; color: #fca5a5; font-size: 14px; text-align: center;">
                ⏰ <strong>Important :</strong> Ce lien expire dans 7 jours. Veuillez choisir vos nouveaux créneaux rapidement.
              </p>
            </div>

            <p style="color: #94a3b8; font-size: 14px; margin: 24px 0 0 0; text-align: center;">
              Si vous avez des questions, n'hésitez pas à nous contacter.<br>
              Merci de votre compréhension ! 🙏
            </p>
          </div>

          <!-- Footer -->
          <div style="background: rgba(0,0,0,0.2); padding: 20px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="margin: 0; color: #64748b; font-size: 12px;">
              © 2024 Tattoo Studio Management - Email automatique
            </p>
          </div>
        </div>
      `;

      // Envoyer l'email
      await this.mailService.sendMail({
        to: clientEmail,
        subject: emailSubject,
        html: emailContent,
      });

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

  //! TRAITER LA RÉPONSE CLIENT POUR REPROGRAMMATION
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
      // Vérifier s'il y a des conflits avec d'autres RDV
      const conflictingAppointments = await this.prisma.appointment.findMany({
        where: {
          tatoueurId,
          id: { not: appointmentId }, // Exclure le RDV actuel
          status: { in: ['PENDING', 'CONFIRMED'] }, // Uniquement les RDV actifs
          OR: [
            {
              start: { lte: newStartDate },
              end: { gt: newStartDate },
            },
            {
              start: { lt: newEndDate },
              end: { gte: newEndDate },
            },
            {
              start: { gte: newStartDate },
              end: { lte: newEndDate },
            },
          ],
        },
      });

      if (conflictingAppointments.length > 0) {
        return {
          error: true,
          message: 'Le tatoueur n\'est pas disponible sur ce créneau. Veuillez choisir un autre horaire.',
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

      const confirmationSubject = '✅ Rendez-vous reprogrammé avec succès !';
      const confirmationContent = `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              ✅ Rendez-vous Reprogrammé !
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 16px; color: rgba(255,255,255,0.9);">
              Votre nouveau créneau a été confirmé
            </p>
          </div>

          <!-- Content -->
          <div style="padding: 32px 24px;">
            <p style="font-size: 18px; margin: 0 0 24px 0; color: #f1f5f9;">
              Bonjour <strong style="color: #60a5fa;">${clientName}</strong>,
            </p>

            <div style="background: rgba(16, 185, 129, 0.1); border-left: 4px solid #10b981; padding: 20px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0 0 16px 0; color: #f1f5f9; font-size: 16px;">
                🎉 Parfait ! Votre rendez-vous a été reprogrammé avec succès :
              </p>
              <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px;">
                <p style="margin: 0 0 8px 0; color: #cbd5e1;"><strong>📅 Nouvelle date :</strong> ${newAppointmentDate}</p>
                <p style="margin: 0; color: #cbd5e1;"><strong>👨‍🎨 Tatoueur :</strong> ${tatoueurName}</p>
              </div>
            </div>

            ${clientMessage ? `
              <div style="background: rgba(99, 102, 241, 0.1); border-left: 4px solid #6366f1; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #6366f1; font-weight: 600;">Votre message :</p>
                <p style="margin: 0; color: #e2e8f0; font-style: italic;">"${clientMessage}"</p>
              </div>
            ` : ''}

            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0; color: #6ee7b7; font-size: 14px; text-align: center;">
                ✅ <strong>Confirme :</strong> Votre rendez-vous est maintenant confirmé pour le nouveau créneau.
              </p>
            </div>

            <p style="color: #94a3b8; font-size: 14px; margin: 24px 0 0 0; text-align: center;">
              Merci pour votre flexibilité ! Nous avons hâte de vous voir. 🎨<br>
              Si vous avez des questions, n'hésitez pas à nous contacter.
            </p>
          </div>

          <!-- Footer -->
          <div style="background: rgba(0,0,0,0.2); padding: 20px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="margin: 0; color: #64748b; font-size: 12px;">
              © 2024 Tattoo Studio Management - Email automatique
            </p>
          </div>
        </div>
      `;

      // Envoyer l'email de confirmation au client
      await this.mailService.sendMail({
        to: clientEmail,
        subject: confirmationSubject,
        html: confirmationContent,
      });

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

        const salonNotificationSubject = '🔄 Client a accepté la reprogrammation';
        const salonNotificationContent = `
          <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                ✅ Reprogrammation Acceptée
              </h1>
              <p style="margin: 8px 0 0 0; font-size: 16px; color: rgba(255,255,255,0.9);">
                Le client a choisi ses nouveaux créneaux
              </p>
            </div>

            <!-- Content -->
            <div style="padding: 32px 24px;">
              <p style="font-size: 18px; margin: 0 0 24px 0; color: #f1f5f9;">
                Bonjour <strong style="color: #60a5fa;">${salonInfo.salonName || 'Salon'}</strong>,
              </p>

              <div style="background: rgba(16, 185, 129, 0.1); border-left: 4px solid #10b981; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 16px 0; color: #f1f5f9; font-size: 16px;">
                  🎉 Le client <strong>${clientName}</strong> a accepté la reprogrammation et choisi un nouveau créneau :
                </p>
                <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px;">
                  <p style="margin: 0 0 8px 0; color: #f87171;"><strong>📅 Ancien créneau :</strong> ${originalAppointmentDateStr}</p>
                  <p style="margin: 0 0 8px 0; color: #6ee7b7;"><strong>📅 Nouveau créneau :</strong> ${newAppointmentDate}</p>
                  <p style="margin: 0; color: #cbd5e1;"><strong>👨‍🎨 Tatoueur :</strong> ${tatoueurName}</p>
                </div>
              </div>

              <div style="background: rgba(99, 102, 241, 0.1); border-left: 4px solid #6366f1; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #f1f5f9; font-weight: 600;">Informations du client :</p>
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px;">
                  <p style="margin: 0 0 4px 0; color: #cbd5e1;"><strong>Nom :</strong> ${clientName}</p>
                  <p style="margin: 0 0 4px 0; color: #cbd5e1;"><strong>Email :</strong> ${clientEmail}</p>
                  <p style="margin: 0; color: #cbd5e1;"><strong>Prestation :</strong> ${updatedAppointment.prestation}</p>
                </div>
              </div>

              ${clientMessage ? `
                <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
                  <p style="margin: 0 0 8px 0; color: #f59e0b; font-weight: 600;">Message du client :</p>
                  <p style="margin: 0; color: #e2e8f0; font-style: italic;">"${clientMessage}"</p>
                </div>
              ` : ''}

              <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 16px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0; color: #6ee7b7; font-size: 14px; text-align: center;">
                  ✅ <strong>Status :</strong> Le rendez-vous a été automatiquement confirmé pour le nouveau créneau.
                </p>
              </div>

              <p style="color: #94a3b8; font-size: 14px; margin: 24px 0 0 0; text-align: center;">
                Le client a été notifié par email de la confirmation.<br>
                Vous pouvez retrouver ce rendez-vous dans votre planning. 📅
              </p>
            </div>

            <!-- Footer -->
            <div style="background: rgba(0,0,0,0.2); padding: 20px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="margin: 0; color: #64748b; font-size: 12px;">
                © 2024 Tattoo Studio Management - Notification automatique
              </p>
            </div>
          </div>
        `;

        // Envoyer l'email de notification au salon
        await this.mailService.sendMail({
          to: salonInfo.email,
          subject: salonNotificationSubject,
          html: salonNotificationContent,
        });
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
}