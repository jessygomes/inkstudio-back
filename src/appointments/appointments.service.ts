/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAppointmentDto, PrestationType } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { MailService } from 'src/mailer.service';
import { FollowupSchedulerService } from 'src/follow-up/followup-scheduler.service';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService, private readonly mailService: MailService, private readonly followupSchedulerService: FollowupSchedulerService) {}

  //! CREER UN RDV
 async create({ rdvBody }: {rdvBody: CreateAppointmentDto}) {
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

  //! VOIR LES RDV DU JOUR POUR DASHBOARD
  async getTodaysAppointments(userId: string) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          start: {
            gte: today,
            lt: tomorrow,
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
          start: 'asc', // Trier par date croissante
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
}