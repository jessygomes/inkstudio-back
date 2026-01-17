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
import { VideoCallService } from 'src/video-call/video-call.service';
import { CacheService } from 'src/redis/cache.service';
import { ConversationsService } from 'src/messaging/conversations/conversations.service';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService, 
    private readonly mailService: MailService, 
    private readonly followupSchedulerService: FollowupSchedulerService,
    private readonly saasService: SaasService,
    private readonly videoCallService: VideoCallService,
    private cacheService: CacheService,
    private readonly conversationsService: ConversationsService
  ) {}

  //! ------------------------------------------------------------------------------

  //! GESTION DU CACHE DASHBOARD

  //! ------------------------------------------------------------------------------
  /**
   * Invalide tous les caches liés au dashboard pour un salon
   * À appeler après toute modification d'un rendez-vous
   * @param userId - ID du salon
   * @param appointmentData - Données du RDV pour optimiser l'invalidation
   */
  private async invalidateDashboardCache(userId: string, appointmentData?: { start?: Date, isPayed?: boolean }) {
    try {
      const keysToDelete = [
        `dashboard:global-cancellation:${userId}`,
      ];

      // Si on a des infos sur le RDV, optimiser l'invalidation
      if (appointmentData?.start) {
        const appointmentDate = new Date(appointmentData.start);
        const year = appointmentDate.getFullYear();
        const month = appointmentDate.getMonth() + 1;
        const dateKey = appointmentDate.toISOString().split('T')[0];
        
        keysToDelete.push(
          `dashboard:today-appointments:${userId}:${dateKey}`,
          `dashboard:monthly-paid:${userId}:${year}-${month.toString().padStart(2, '0')}`
        );
      }

      // Invalider les clés spécifiques
      for (const key of keysToDelete) {
        try {
          await this.cacheService.del(key);
        } catch (error) {
          console.warn(`Erreur invalidation cache dashboard clé ${key}:`, error);
        }
      }

      // Pour les caches avec patterns complexes (fill-rate), on invalide manuellement les plus probables
      if (appointmentData?.start) {
        const appointmentDate = new Date(appointmentData.start);
        // Invalider les fill-rate des 7 derniers jours autour de la date du RDV
        for (let i = -3; i <= 3; i++) {
          const checkDate = new Date(appointmentDate);
          checkDate.setDate(appointmentDate.getDate() + i);
          const startWeek = checkDate.toISOString().split('T')[0];
          const endWeek = new Date(checkDate);
          endWeek.setDate(checkDate.getDate() + 7);
          const endWeekStr = endWeek.toISOString().split('T')[0];
          
          try {
            await this.cacheService.del(`dashboard:fill-rate:${userId}:${startWeek}:${endWeekStr}`);
          } catch {
            // Ignore les erreurs pour ces clés optionnelles
          }
        }
      }

    } catch (error) {
      console.warn('Erreur invalidation cache dashboard:', error);
    }
  }

//! ------------------------------------------------------------------------------

  //! CREER UN RDV

  //! ------------------------------------------------------------------------------
  async create({ userId, rdvBody }: {userId: string, rdvBody: CreateAppointmentDto}) {
    try {
      const {  title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, clientBirthdate, tatoueurId, visio, visioRoom } = rdvBody;

      // S'assurer que title a toujours une valeur
      const appointmentTitle = title || `${prestation} - ${clientFirstname} ${clientLastname}`;

      // Convertir la date de naissance en objet Date si elle est fournie
      const parsedBirthdate = clientBirthdate ? new Date(clientBirthdate) : null;

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
          status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULING'] }, // Exclure les rendez-vous annulés
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

      // Vérifier s'il existe un utilisateur connecté avec cet email (role="client")
      const clientUser = await this.prisma.user.findUnique({
        where: {
          email: clientEmail,
          role: 'client',
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          clientProfile: {
            select: {
              birthDate: true,
            }
          }
        }
      });

      let client = await this.prisma.client.findFirst({
        where: {
          email: clientEmail,
          userId: userId, // Pour que chaque salon ait ses propres clients
        },
      });

      if (!client) {
        // Créer le client s'il n'existe pas
        // Si c'est un client connecté, utiliser ses données du compte utilisateur
        const clientData = clientUser ? {
          firstName: clientUser.firstName || clientFirstname,
          lastName: clientUser.lastName || clientLastname,
          email: clientEmail,
          phone: clientUser.phone || clientPhone || "",
          birthDate: clientUser.clientProfile?.birthDate || parsedBirthdate,
          userId,
          linkedUserId: clientUser.id, // Lier au compte utilisateur connecté
        } : {
          firstName: clientFirstname,
          lastName: clientLastname,
          email: clientEmail,
          phone: clientPhone || "",
          birthDate: parsedBirthdate,
          userId,
        };

        client = await this.prisma.client.create({
          data: clientData,
        });
      } else {
        // Si le client existe, vérifier s'il faut créer ou mettre à jour la liaison
        if (clientUser) {
          if (!client.linkedUserId) {
            // Créer la liaison si elle n'existe pas
            client = await this.prisma.client.update({
              where: { id: client.id },
              data: { linkedUserId: clientUser.id }
            });
          }

          // Mettre à jour les infos de la fiche client avec celles du compte utilisateur
          const updatedData: any = {};
          
          // Synchroniser les données si elles sont différentes ou manquantes
          if (clientUser.firstName && (!client.firstName || client.firstName !== clientUser.firstName)) {
            updatedData.firstName = clientUser.firstName;
          }
          
          if (clientUser.lastName && (!client.lastName || client.lastName !== clientUser.lastName)) {
            updatedData.lastName = clientUser.lastName;
          }
          
          if (clientUser.phone && (!client.phone || client.phone !== clientUser.phone)) {
            updatedData.phone = clientUser.phone;
          }
          
          if (clientUser.clientProfile?.birthDate && (!client.birthDate || client.birthDate.getTime() !== clientUser.clientProfile.birthDate.getTime())) {
            updatedData.birthDate = clientUser.clientProfile.birthDate;
          }

          // Appliquer les mises à jour si nécessaire
          if (Object.keys(updatedData).length > 0) {
            client = await this.prisma.client.update({
              where: { id: client.id },
              data: updatedData
            });
          }
        }
      }

      // Générer le lien de visioconférence si nécessaire
      let generatedVisioRoom = visioRoom;
      if (visio && !visioRoom) {
        // Récupérer le nom du salon pour personnaliser le lien
        const salon = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { salonName: true }
        });
        
        // Générer un ID temporaire pour créer le lien vidéo
        const tempAppointmentId = crypto.randomBytes(8).toString('hex');
        generatedVisioRoom = this.videoCallService.generateVideoCallLink(tempAppointmentId, salon?.salonName || undefined);
      }

      if (prestation === PrestationType.PROJET || prestation === PrestationType.TATTOO || prestation === PrestationType.PIERCING || prestation === PrestationType.RETOUCHE) {
        // Créer le rendez-vous
        const newAppointment = await this.prisma.appointment.create({
          data: {
            userId,
            title: appointmentTitle,
            prestation,
            start: new Date(start),
            end: new Date(end),
            tatoueurId,
            clientId: client.id,
            clientUserId: clientUser?.id, // Lier au client connecté si applicable
            status: 'CONFIRMED',
            visio: visio || false,
            visioRoom: generatedVisioRoom
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

        // Gérer les détails spécifiques selon le type de prestation
        if (prestation === PrestationType.PIERCING) {
          // Pour les piercings, récupérer le prix automatiquement si possible
          let piercingPrice = rdvBody.price || rdvBody.estimatedPrice || 0;

          // Déterminer l'ID du service de piercing depuis les données du front
          let piercingServiceId = rdvBody.piercingServicePriceId;
          
          // Si pas d'ID direct, chercher dans les anciens champs
          if (!piercingServiceId) {
            piercingServiceId = rdvBody.piercingZoneOreille || 
                              rdvBody.piercingZoneVisage || 
                              rdvBody.piercingZoneBouche || 
                              rdvBody.piercingZoneCorps || 
                              rdvBody.piercingZoneMicrodermal;
          }

          if (piercingServiceId) {
            try {
              const piercingPriceConfig = await this.prisma.piercingServicePrice.findUnique({
                where: {
                  id: piercingServiceId,
                  userId,
                  isActive: true,
                },
                select: {
                  price: true,
                },
              });

              if (piercingPriceConfig) {
                piercingPrice = piercingPriceConfig.price;
              }
            } catch (priceError) {
              console.warn('⚠️ Erreur lors de la récupération du prix piercing par ID:', priceError);
            }
          }

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
              // Champs spécifiques aux piercings
              piercingZone: rdvBody.piercingZone,
              piercingServicePriceId: piercingServiceId,
              estimatedPrice: rdvBody.estimatedPrice || piercingPrice,
              price: piercingPrice,
            },
          });

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        } else {
          // Pour les autres prestations (TATTOO, PROJET, RETOUCHE)
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

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        }
        
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
                tatoueur: newAppointment.tatoueur?.name || 'Non assigné',
                visio: visio || false,
                visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
              }
            },
            salon?.salonName || undefined, // Passer le nom du salon
            undefined, // salonEmail
            userId // Passer l'ID utilisateur pour les couleurs
          );
        } catch (emailError) {
          console.error('💥 ERREUR lors de l\'envoi de l\'email PROJET/TATTOO:', emailError);
          // Ne pas faire échouer la création du RDV si l'email échoue
        }

        // Invalider le cache des listes de RDV après création
        await this.cacheService.delPattern(`appointments:salon:${userId}:*`);
        await this.cacheService.delPattern(`appointments:date-range:${userId}:*`);

        // Créer une conversation automatiquement si le client est connecté
        if (clientUser && clientUser.role === 'client') {
          try {
            const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
              prestation === PrestationType.TATTOO ? 'Tatouage' :
              prestation === PrestationType.PIERCING ? 'Piercing' :
              prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;

            await this.conversationsService.createConversation(userId, {
              clientUserId: clientUser.id,
              appointmentId: newAppointment.id,
              subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
              firstMessage: `Bonjour ${client.firstName}, votre rendez-vous a été confirmé ! N'hésitez pas à nous contacter pour toute question.`,
            });
          } catch (conversationError) {
            console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
            // Ne pas faire échouer la création du RDV si la conversation échoue
          }
        }
      
        return {
          error: false,
          message: 'Rendez-vous projet créé avec détail tatouage.',
          appointment: newAppointment,
          clientLinked: !!clientUser, // Indiquer si le client était connecté
          // tattooDetail,
        };
      }

      // Créer le rendez-vous
      const newAppointment = await this.prisma.appointment.create({
        data: {
          userId,
          title: appointmentTitle,
          prestation,
          start: new Date(start),
          end: new Date(end),
          tatoueurId,
          clientId: client.id,
          clientUserId: clientUser?.id, // Lier au client connecté si applicable
          visio: visio || false,
          visioRoom: generatedVisioRoom
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
              tatoueur: newAppointment.tatoueur?.name || 'Non assigné',
              visio: visio || false,
              visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
            }
          },
          salon?.salonName || undefined // Passer le nom du salon
        );
      } catch (emailError) {
        console.error('💥 ERREUR lors de l\'envoi de l\'email:', emailError);
        // Ne pas faire échouer la création du RDV si l'email échoue
      }

      // Invalider le cache des listes de RDV après création
      await this.cacheService.delPattern(`appointments:salon:${userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(userId, { 
        start: newAppointment.start, 
        isPayed: newAppointment.isPayed 
      });
      
      // Créer une conversation automatiquement si le client est connecté
      if (clientUser && clientUser.role === 'client') {
        try {
          const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
            prestation === PrestationType.TATTOO ? 'Tatouage' :
            prestation === PrestationType.PIERCING ? 'Piercing' :
            prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;

          await this.conversationsService.createConversation(userId, {
            clientUserId: clientUser.id,
            appointmentId: newAppointment.id,
            subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
            firstMessage: `Bonjour ${client.firstName}, votre rendez-vous a été confirmé ! N'hésitez pas à nous contacter pour toute question.`,
          });
        } catch (conversationError) {
          console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
          // Ne pas faire échouer la création du RDV si la conversation échoue
        }
      }

      return {
        error: false,
        message: 'Rendez-vous créé avec succès.',
        appointment: newAppointment,
        clientLinked: !!clientUser, // Indiquer si le client était connecté
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
  async createByClient({ userId, rdvBody }: {userId: string | undefined, rdvBody: CreateAppointmentDto}) {
    try {
      // Vérifier que userId est fourni
      if (!userId) {
        return {
          error: true,
          message: 'ID du salon requis.',
        };
      }

      const { title, prestation, start, end, clientFirstname, clientLastname, clientEmail, clientPhone, clientBirthdate, tatoueurId, visio, visioRoom } = rdvBody;

      // S'assurer que title a toujours une valeur
      const appointmentTitle = title || `${prestation} - ${clientFirstname} ${clientLastname}`;

      // Convertir la date de naissance en objet Date si elle est fournie
      const parsedBirthdate = clientBirthdate ? new Date(clientBirthdate) : null;

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
          status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULING'] }, // Exclure les rendez-vous annulés
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

      // Vérifier s'il existe un utilisateur connecté avec cet email (role="client")
      const clientUser = await this.prisma.user.findUnique({
        where: {
          email: clientEmail,
          role: 'client',
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          clientProfile: {
            select: {
              birthDate: true
            }
          }
        }
      });

      let client = await this.prisma.client.findFirst({
        where: {
          email: clientEmail,
          userId: userId, // Pour que chaque salon ait ses propres clients
        },
      });

      if (!client) {
        // Créer le client s'il n'existe pas
        // Si c'est un client connecté, utiliser ses données
        const clientData = clientUser ? {
          firstName: clientUser.firstName || clientFirstname,
          lastName: clientUser.lastName || clientLastname,
          email: clientEmail,
          phone: clientUser.phone || clientPhone || "",
          birthDate: clientUser.clientProfile?.birthDate || parsedBirthdate,
          userId,
          linkedUserId: clientUser.id, // Lier au compte utilisateur connecté
        } : {
          firstName: clientFirstname,
          lastName: clientLastname,
          email: clientEmail,
          phone: clientPhone || "",
          birthDate: parsedBirthdate,
          userId,
        };

        client = await this.prisma.client.create({
          data: clientData,
        });
      } else if (clientUser && !client.linkedUserId) {
        // Si le client existe mais n'est pas encore lié au compte utilisateur, créer la liaison
        client = await this.prisma.client.update({
          where: { id: client.id },
          data: { linkedUserId: clientUser.id }
        });
      }

      // Récupérer les informations du salon pour vérifier addConfirmationEnabled
      const salon = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { addConfirmationEnabled: true, salonName: true, email: true, appointmentBookingEnabled: true },
      });

      if (!salon) {
        return {
          error: true,
          message: 'Salon introuvable.',
        };
      }

      // Déterminer le statut du rendez-vous selon addConfirmationEnabled
      const appointmentStatus = salon.addConfirmationEnabled ? 'PENDING' : 'CONFIRMED';

      // Générer le lien de visioconférence si nécessaire
      let generatedVisioRoom = visioRoom;
      if (visio && !visioRoom) {
        // Générer un ID temporaire pour créer le lien vidéo
        const tempAppointmentId = crypto.randomBytes(8).toString('hex');
        generatedVisioRoom = this.videoCallService.generateVideoCallLink(tempAppointmentId, salon?.salonName || undefined);
      }

      if (prestation === PrestationType.PROJET || prestation === PrestationType.TATTOO || prestation === PrestationType.PIERCING || prestation === PrestationType.RETOUCHE) {
        const newAppointment = await this.prisma.appointment.create({
          data: {
            userId,
            title: appointmentTitle,
            prestation,
            start: new Date(start),
            end: new Date(end),
            tatoueurId,
            clientId: client.id,
            clientUserId: clientUser?.id, // Lier au client connecté si applicable
            status: appointmentStatus,
            visio: visio || false,
            visioRoom: generatedVisioRoom
          },
        });
      
        // Gérer les détails spécifiques selon le type de prestation
        if (prestation === PrestationType.PIERCING) {
          // Pour les piercings, récupérer le prix automatiquement si possible
          let piercingPrice = rdvBody.price || rdvBody.estimatedPrice || 0;

          // Déterminer l'ID du service de piercing depuis les données du front
          let piercingServiceId = rdvBody.piercingServicePriceId;
          
          // Si pas d'ID direct, chercher dans les anciens champs
          if (!piercingServiceId) {
            piercingServiceId = rdvBody.piercingZoneOreille || 
            rdvBody.piercingZoneVisage || 
            rdvBody.piercingZoneBouche || 
            rdvBody.piercingZoneCorps || 
            rdvBody.piercingZoneMicrodermal;
          }

          if (piercingServiceId) {
            try {
              const piercingPriceConfig = await this.prisma.piercingServicePrice.findUnique({
                where: {
                  id: piercingServiceId,
                  userId,
                  isActive: true,
                },
                select: {
                  price: true,
                },
              });

              if (piercingPriceConfig) {
                piercingPrice = piercingPriceConfig.price;
              }
            } catch (priceError) {
              console.warn('⚠️ Erreur lors de la récupération du prix piercing par ID:', priceError);
            }
          }

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
              // Champs spécifiques aux piercings
              piercingZone: rdvBody.piercingZone,
              piercingServicePriceId: piercingServiceId,
              estimatedPrice: rdvBody.estimatedPrice || piercingPrice,
              price: piercingPrice,
            },
          });

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        } else {
          // Pour les autres prestations (TATTOO, PROJET, RETOUCHE)
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

          // Mettre à jour l'appointment avec l'ID du tattooDetail
          await this.prisma.appointment.update({
            where: { id: newAppointment.id },
            data: { tattooDetailId: tattooDetail.id },
          });
        }

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
                clientPhone: client.phone,
                visio: visio || false,
                visioRoom: generatedVisioRoom
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
                tatoueur: artist.name,
                visio: visio || false,
                visioRoom: generatedVisioRoom
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
                clientPhone: client.phone,
                visio: visio || false,
                visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
              }
            },
            salon.salonName || undefined
          );
        }
      
        return {
          error: false,
          message: salon.addConfirmationEnabled 
            ? `Rendez-vous ${prestation.toLowerCase()} créé en attente de confirmation.` 
            : `Rendez-vous ${prestation.toLowerCase()} créé avec succès.`,
          appointment: newAppointment,
          // tattooDetail,
          status: appointmentStatus,
        };
      }

      // Créer le rendez-vous
      const newAppointment = await this.prisma.appointment.create({
        data: {
          userId,
          title: appointmentTitle,
          prestation,
          start: new Date(start),
          end: new Date(end),
          tatoueurId,
          clientId: client.id,
          clientUserId: clientUser?.id, // Lier au client connecté si applicable
          status: appointmentStatus,
          visio: visio || false,
          visioRoom: generatedVisioRoom
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
              clientPhone: client.phone,
              visio: visio || false,
              visioRoom: generatedVisioRoom
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
              tatoueur: artist.name,
              visio: visio || false,
              visioRoom: generatedVisioRoom
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
              clientPhone: client.phone,
              visio: visio || false,
              visioRoom: visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${newAppointment.id}` : generatedVisioRoom
            }
          },
          salon.salonName || undefined
        );
      }

      // Créer une conversation automatiquement si le client est connecté
      if (clientUser?.id) {
        try {
          const prestationLabel = prestation === PrestationType.PROJET ? 'Projet tatouage' :
            prestation === PrestationType.TATTOO ? 'Tatouage' :
            prestation === PrestationType.PIERCING ? 'Piercing' :
            prestation === PrestationType.RETOUCHE ? 'Retouche' : prestation;
          
          const statusMessage = appointmentStatus === 'PENDING' 
            ? `Votre demande de rendez-vous a bien été enregistrée et est en attente de confirmation par le salon.`
            : `Votre rendez-vous a été confirmé automatiquement !`;
          
          await this.conversationsService.createConversation(userId, {
            clientUserId: clientUser.id,
            appointmentId: newAppointment.id,
            subject: `RDV ${prestationLabel} - ${newAppointment.start.toLocaleDateString('fr-FR')}`,
            firstMessage: `Bonjour ${client.firstName}, ${statusMessage} N'hésitez pas à nous contacter pour toute question.`,
          });
        } catch (conversationError) {
          console.error('⚠️ Erreur lors de la création de la conversation:', conversationError);
          // Ne pas faire échouer la création du RDV si la conversation échoue
        }
      }

      return {
        error: false,
        message: salon.addConfirmationEnabled 
          ? `Rendez-vous créé en attente de confirmation.` 
          : `Rendez-vous créé avec succès.`,
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

      // Créer une clé de cache basée sur les paramètres
      const cacheKey = `appointments:date-range:${userId}:${JSON.stringify({
        startDate,
        endDate,
        page,
        limit
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        appointments: any[];
        pagination: any;
      }>(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

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

      const result = {
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

      // 3. Mettre en cache (TTL 5 minutes pour les listes par date)
      await this.cacheService.set(cacheKey, result, 300);

      return result;
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
  async getAllAppointmentsBySalon(
    salonId: string, 
    page: number = 1, 
    limit: number = 5,
    status?: string,
    period?: 'upcoming' | 'past',
    tatoueurId?: string,
    prestation?: string,
    search?: string
  ) {
    try {
      const skip = (page - 1) * limit;

      // Créer une clé de cache basée sur les paramètres incluant les filtres
      const cacheKey = `appointments:salon:${salonId}:${JSON.stringify({
        page,
        limit,
        status,
        period,
        tatoueurId,
        prestation,
        search
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        appointments: any[];
        pagination: any;
        allTatoueurs: any[];
        allPrestations: string[];
      }>(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      // Construire les conditions de filtrage
      const now = new Date();
      const whereConditions: any = {
        userId: salonId,
      };

      // Filtre par statut
      if (status) {
        whereConditions.status = status;
      }

      // Filtre par période (à venir ou passée)
      if (period === 'upcoming') {
        whereConditions.start = { gte: now };
      } else if (period === 'past') {
        whereConditions.start = { lt: now };
      }

      // Filtre par tatoueur
      if (tatoueurId) {
        whereConditions.tatoueurId = tatoueurId;
      }

      // Filtre par type de prestation
      if (prestation) {
        whereConditions.prestation = prestation;
      }

      // Filtre de recherche par nom/prénom du client et titre
      if (search) {
        whereConditions.OR = [
          {
            client: {
              firstName: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
          {
            client: {
              lastName: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
          {
            title: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ];
      }

      // Récupérer en parallèle : les RDV filtrés, le total, tous les tatoueurs et toutes les prestations
      const [appointments, totalAppointments, allTatoueurs, allPrestationsResult] = await Promise.all([
        // Rendez-vous filtrés avec pagination
        this.prisma.appointment.findMany({
          where: whereConditions,
          include: {
            tatoueur: {
              select: {
                id: true,
                name: true,
              },
            },
            salonReview: true,
            tattooDetail: true,
            client: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            conversation: {
              select: {
                id: true,
              },
            },
          },
          orderBy: {
            start: 'desc',
          },
          skip,
          take: limit,
        }),
        // Total des RDV correspondant aux filtres
        this.prisma.appointment.count({
          where: whereConditions,
        }),
        // Tous les tatoueurs du salon (pour les filtres)
        this.prisma.tatoueur.findMany({
          where: {
            userId: salonId,
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: {
            name: 'asc',
          },
        }),
        // Toutes les prestations utilisées par le salon (pour les filtres)
        this.prisma.appointment.findMany({
          where: {
            userId: salonId,
          },
          select: {
            prestation: true,
          },
          distinct: ['prestation'],
        }),
      ]);

      // Extraire les prestations uniques
      const allPrestations = allPrestationsResult.map(a => a.prestation).filter(Boolean);

      const totalPages = Math.ceil(totalAppointments / limit);

      const result = {
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
        allTatoueurs, // Tous les tatoueurs pour les filtres
        allPrestations, // Tous les types de rdv pour les filtres
      };

      // 3. Mettre en cache (TTL 5 minutes)
      await this.cacheService.set(cacheKey, result, 300);

      return result;
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
          status: {
            not: 'CANCELED' // Exclure les rendez-vous annulés
          },
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
      const cacheKey = `appointment:${id}`;

      // 1. Vérifier dans Redis
      const cachedAppointment = await this.cacheService.get<{
        id: string;
        title: string;
        start: Date;
        end: Date;
        [key: string]: any;
      }>(cacheKey);
      
      if (cachedAppointment) {
        return cachedAppointment;
      }

      // 2. Sinon, aller chercher en DB
      const appointment = await this.prisma.appointment.findUnique({
        where: {
          id,
        },
        include: {
          tatoueur: true,
          tattooDetail: true,
          salonReview: true,
        },
      });

      // 3. Mettre en cache si trouvé (TTL 10 minutes pour un RDV spécifique)
      if (appointment) {
        await this.cacheService.set(cacheKey, appointment, 600);
      }

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
      // Récupérer le RDV avant suppression pour l'invalidation du cache
      const appointmentToDelete = await this.prisma.appointment.findUnique({
        where: { id },
        select: { 
          userId: true,
          start: true,
          isPayed: true
        }
      });

      if (!appointmentToDelete) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.',
        };
      }

      const appointment = await this.prisma.appointment.delete({
        where: {
          id,
        },
      });

      // Invalider le cache après suppression
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${appointmentToDelete.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${appointmentToDelete.userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(appointmentToDelete.userId, { 
        start: appointmentToDelete.start, 
        isPayed: appointmentToDelete.isPayed 
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

  // ! -------------------------------------------------------------------------

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
              tatoueur: artist.name,
              visio: updatedAppointment.visio || false,
              visioRoom: updatedAppointment.visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${updatedAppointment.id}` : updatedAppointment.visioRoom || undefined
            }
          },
          salon?.salonName || undefined
        );
      }

      // Invalider le cache après update
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(existingAppointment.userId, { 
        start: updatedAppointment.start, 
        isPayed: updatedAppointment.isPayed 
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

  //! ------------------------------------------------------------------------------

  //! MODIFIER UN RDV PAR LE CLIENT

  //! ------------------------------------------------------------------------------
  async updateAppointmentByClient(appointmentId: string, userId: string, rdvBody: { start: string; end: string; tatoueurId?: string }) {
    try {
      // Récupérer le RDV avec toutes les informations nécessaires
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          client: true,
          tatoueur: true,
          user: {
            select: {
              salonName: true,
              email: true,
              addConfirmationEnabled: true,
            },
          },
        },
      });

      if (!existingAppointment) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.',
        };
      }

      // Vérifier que le client connecté est bien le propriétaire du RDV
      if (existingAppointment.clientUserId !== userId) {
        return {
          error: true,
          message: 'Vous n\'avez pas le droit de modifier ce rendez-vous.',
        };
      }

      // Vérifier que le RDV n'est pas déjà terminé ou complet
      if (['COMPLETED', 'NO_SHOW', 'CANCELED'].includes(existingAppointment.status)) {
        return {
          error: true,
          message: 'Vous ne pouvez pas modifier un rendez-vous terminé, annulé ou complété.',
        };
      }

      const { start, end, tatoueurId } = rdvBody;

      // Vérifier si le tatoueur existe si fourni
      if (tatoueurId && tatoueurId !== existingAppointment.tatoueurId) {
        const artist = await this.prisma.tatoueur.findUnique({
          where: { id: tatoueurId },
        });

        if (!artist) {
          return {
            error: true,
            message: 'Tatoueur introuvable.',
          };
        }
      }

      // Déterminer le nouveau statut selon le paramètre addConfirmationEnabled du salon
      const newAppointmentStatus = existingAppointment.user.addConfirmationEnabled ? 'PENDING' : existingAppointment.status;

      // Mettre à jour le rendez-vous (dates, heure et tatoueur)
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          start: new Date(start),
          end: new Date(end),
          tatoueurId: tatoueurId || existingAppointment.tatoueurId,
          status: newAppointmentStatus,
        },
        include: {
          client: true,
          tatoueur: true,
        },
      });

      // Envoyer un email de confirmation au client
      if (updatedAppointment.client) {
        try {
          await this.mailService.sendAppointmentModification(
            updatedAppointment.client.email,
            {
              recipientName: `${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName}`,
              appointmentDetails: {
                date: updatedAppointment.start.toLocaleDateString('fr-FR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
                time: `${updatedAppointment.start.toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })} - ${updatedAppointment.end.toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`,
                service: updatedAppointment.prestation,
                tatoueur: updatedAppointment.tatoueur?.name || 'Non assigné',
                visio: updatedAppointment.visio || false,
                visioRoom: updatedAppointment.visio
                  ? `${process.env.FRONTEND_URL || '#'}/meeting/${updatedAppointment.id}`
                  : updatedAppointment.visioRoom || undefined,
              },
            },
            existingAppointment.user?.salonName || undefined,
            existingAppointment.user?.email || undefined
          );
        } catch (emailError) {
          console.error('⚠️ Erreur lors de l\'envoi de l\'email au client:', emailError);
        }
      }

      // Envoyer un email de notification au salon
      if (existingAppointment.user?.email && updatedAppointment.client) {
        try {
          const clientName = `${updatedAppointment.client.firstName} ${updatedAppointment.client.lastName}`;
          
          // Formater les dates
          const appointmentDate = updatedAppointment.start.toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          
          const appointmentTime = `${updatedAppointment.start.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          })} - ${updatedAppointment.end.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          })}`;

          // Créer un message personnalisé pour le salon
          const statusInfo = newAppointmentStatus === 'PENDING'
            ? '⚠️ Ce rendez-vous est en attente de votre confirmation.'
            : '✅ Ce rendez-vous a été automatiquement confirmé.';

          const emailBody = `
            <strong>${clientName}</strong> a modifié son rendez-vous.
            <br><br>
            ${statusInfo}
            <br><br>
            <strong>📅 Nouveaux détails du rendez-vous :</strong>
            <br><br>
            📅 <strong>Date :</strong> ${appointmentDate}
            <br>
            ⏰ <strong>Heure :</strong> ${appointmentTime}
            <br>
            🎨 <strong>Prestation :</strong> ${updatedAppointment.prestation}
            <br>
            👨‍🎨 <strong>Artiste :</strong> ${updatedAppointment.tatoueur?.name || 'Non assigné'}
            <br><br>
            👤 <strong>Informations client :</strong>
            <br>
            Nom : ${clientName}
            <br>
            Email : ${updatedAppointment.client.email}
            <br>
            Téléphone : ${updatedAppointment.client.phone || 'Non renseigné'}
          `;

          await this.mailService.sendCustomEmail(
            existingAppointment.user.email,
            '🔔 Modification de rendez-vous par un client',
            {
              recipientName: existingAppointment.user.salonName || 'Salon',
              customMessage: emailBody,
            },
            existingAppointment.user.salonName || undefined,
            existingAppointment.user.email
          );
        } catch (emailError) {
          console.error('⚠️ Erreur lors de l\'envoi de l\'email au salon:', emailError);
        }
      }

      // Invalider le cache après modification
      await this.cacheService.del(`appointment:${appointmentId}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`client:appointments:${userId}:*`);

      // Invalider le cache du dashboard
      await this.invalidateDashboardCache(existingAppointment.userId, {
        start: updatedAppointment.start,
        isPayed: updatedAppointment.isPayed,
      });

      return {
        error: false,
        message: newAppointmentStatus === 'PENDING'
          ? 'Rendez-vous modifié et en attente de confirmation du salon.'
          : 'Rendez-vous modifié avec succès.',
        appointment: updatedAppointment,
        status: newAppointmentStatus,
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
              title: appointment.title,
              visio: appointment.visio || false,
              visioRoom: appointment.visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${appointment.id}` : appointment.visioRoom || undefined
            },
            customMessage: message || undefined
          },
          salon?.salonName || undefined,
          salon?.email || undefined
        );
    }

      // Invalider le cache après confirmation
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);

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
          title: appointment.title,
          visio: appointment.visio || false,
          visioRoom: appointment.visio ? `${process.env.FRONTEND_URL || '#'}/meeting/${appointment.id}` : appointment.visioRoom || undefined
        },
        customMessage: message || undefined
      },
      salon?.salonName || undefined,
      salon?.email || undefined
    );
  }

      // Invalider le cache après annulation
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${existingAppointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${existingAppointment.userId}:*`);

      // Invalider le cache du dashboard (annulation change les stats globales)
      await this.invalidateDashboardCache(existingAppointment.userId, { 
        start: existingAppointment.start, 
        isPayed: existingAppointment.isPayed 
      });

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

//! ANNULER UN RDV PAR LE CLIENT

//! ------------------------------------------------------------------------------
async cancelAppointmentByClient(appointmentId: string, clientUserId: string, reason?: string) {
  try {
    // Récupérer le rendez-vous avec toutes les informations nécessaires
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        client: true,
        tatoueur: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            salonName: true,
            email: true
          }
        }
      }
    });

    if (!appointment) {
      return {
        error: true,
        message: 'Rendez-vous introuvable.'
      };
    }

    // Vérifier que le client connecté est bien celui du RDV
    if (appointment.clientUserId !== clientUserId) {
      return {
        error: true,
        message: 'Vous n\'êtes pas autorisé à annuler ce rendez-vous.'
      };
    }

    // Vérifier que le RDV n'est pas déjà annulé ou terminé
    if (appointment.status === 'CANCELED') {
      return {
        error: true,
        message: 'Ce rendez-vous est déjà annulé.'
      };
    }

    if (appointment.status === 'COMPLETED') {
      return {
        error: true,
        message: 'Impossible d\'annuler un rendez-vous terminé.'
      };
    }

    // Mettre à jour le statut du rendez-vous
    const updatedAppointment = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELED'
      }
    });

    // Envoyer un email au salon pour l'informer de l'annulation
    try {
      const clientName = `${appointment.client?.firstName || ''} ${appointment.client?.lastName || ''}`.trim();
      
      // Formater la date et l'heure
      const appointmentDate = new Date(appointment.start).toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      const appointmentTime = `${new Date(appointment.start).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      })} - ${new Date(appointment.end).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      })}`;

      // Email de notification au salon avec template
      await this.mailService.sendClientCancellationNotification(
        appointment.user.email,
        {
          salonName: appointment.user.salonName || undefined,
          clientCancellationDetails: {
            clientName: clientName || 'Client',
            clientEmail: appointment.client?.email,
            clientPhone: appointment.client?.phone,
            appointmentDate,
            appointmentTime,
            prestation: appointment.prestation,
            tatoueurName: appointment.tatoueur?.name,
            cancellationReason: reason
          }
        },
        appointment.user.salonName || undefined,
        appointment.userId
      );

      // Envoyer un email de confirmation au client
      if (appointment.client?.email) {
        await this.mailService.sendClientCancellationConfirmation(
          appointment.client.email,
          {
            recipientName: clientName,
            salonName: appointment.user.salonName || undefined,
            clientCancellationDetails: {
              clientName,
              appointmentDate,
              appointmentTime,
              prestation: appointment.prestation,
              tatoueurName: appointment.tatoueur?.name
            }
          },
          appointment.user.salonName || undefined,
          appointment.user.email,
          appointment.userId
        );
      }
    } catch (emailError) {
      console.error('Erreur lors de l\'envoi des emails d\'annulation:', emailError);
      // Continue même si l'email échoue
    }

    // Invalider les caches
    await this.cacheService.del(`appointment:${appointmentId}`);
    await this.cacheService.delPattern(`appointments:salon:${appointment.userId}:*`);
    await this.cacheService.delPattern(`appointments:date-range:${appointment.userId}:*`);
    await this.cacheService.delPattern(`client:appointments:${clientUserId}:*`);

    // Invalider le cache du dashboard
    await this.invalidateDashboardCache(appointment.userId, { 
      start: appointment.start, 
      isPayed: appointment.isPayed 
    });

    return {
      error: false,
      message: 'Rendez-vous annulé avec succès.',
      appointment: updatedAppointment
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

      // Créer un historique de tatouage si le RDV est COMPLETED et de type TATTOO/PIERCING
      if (status === 'COMPLETED' && 
          (appointment.prestation === 'TATTOO' || appointment.prestation === 'PIERCING') &&
          appointment.client && appointment.tattooDetail) {
        
        try {
          await this.prisma.tattooHistory.create({
            data: {
              clientId: appointment.clientId!,
              tatoueurId: appointment.tatoueurId,
              date: appointment.start, // Date du RDV
              description: appointment.tattooDetail.description || appointment.title,
              zone: appointment.tattooDetail.zone,
              size: appointment.tattooDetail.size,
              price: appointment.tattooDetail.price || 0,
              // Les autres champs sont optionnels et peuvent être renseignés plus tard
              inkUsed: null,
              healingTime: null,
              careProducts: null,
              photo: null,
            },
          });
          
        } catch (historyError) {
          console.error('⚠️ Erreur lors de la création de l\'historique:', historyError);
          // On ne fait pas échouer la mise à jour du statut si l'historique échoue
        }

        // Système de suivi automatique selon le type de prestation
        // Les délais sont calculés à partir du moment où le RDV est marqué COMPLETED
        try {
          const completedTime = new Date(); // Moment actuel = quand le RDV est marqué terminé
          
          // 1. Programmer le suivi de cicatrisation pour TATTOO et PIERCING
          await this.followupSchedulerService.scheduleFollowupFromCompletion(appointment.id, completedTime);
          
          // 2. Programmer le rappel retouches uniquement pour les TATTOO
          if (appointment.prestation === 'TATTOO') {
            this.followupSchedulerService.scheduleRetouchesReminderFromCompletion(appointment.id, completedTime);
          }
        } catch (followupError) {
          console.error('⚠️ Erreur lors de la programmation des suivis:', followupError);
          // On ne fait pas échouer la mise à jour du statut si le suivi échoue
        }
      }

      // Invalider le cache après changement de statut
      await this.cacheService.del(`appointment:${id}`);
      await this.cacheService.delPattern(`appointments:salon:${appointment.userId}:*`);
      await this.cacheService.delPattern(`appointments:date-range:${appointment.userId}:*`);

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
   * Récupère les rendez-vous d'une date spécifique pour le dashboard avec cache Redis
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

      // Début de la journée (00:00:00)
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const dateKey = startOfDay.toISOString().split('T')[0]; // Format YYYY-MM-DD

      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:today-appointments:${userId}:${dateKey}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getTodaysAppointments:', cacheError);
      }

      // ==================== ÉTAPE 2: DÉFINIR LES BORNES DE LA JOURNÉE ====================
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
      const result = {
        error: false,
        appointments,
        selectedDate: dateKey,
        formattedDate,
        totalAppointments: appointments.length,
        message: `${appointments.length} rendez-vous trouvé(s) pour le ${formattedDate}`,
      };

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL différencié: 
        // - Jour actuel: 15 minutes (changements fréquents)
        // - Jours passés: 4 heures (données historiques plus stables)
        // - Jours futurs: 30 minutes (planification qui peut changer)
        const now = new Date();
        const isToday = dateKey === now.toISOString().split('T')[0];
        const isPast = startOfDay < now;
        
        let ttl: number;
        if (isToday) {
          ttl = 15 * 60; // 15 minutes pour le jour actuel
        } else if (isPast) {
          ttl = 4 * 60 * 60; // 4 heures pour les jours passés
        } else {
          ttl = 30 * 60; // 30 minutes pour les jours futurs
        }
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getTodaysAppointments:', cacheError);
      }

      return result;
      
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
   * Calcule le taux de remplissage des créneaux pour une période donnée avec cache Redis
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

      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:fill-rate:${userId}:${startDate}:${endDate}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getWeeklyFillRate:', cacheError);
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
      const result = {
        error: false,
        userId,                 // ID du salon
        startDate,              // Date de début (format original)
        endDate,                // Date de fin (format original)
        totalSlots,             // Nombre total de créneaux disponibles
        filledSlots,            // Nombre de créneaux occupés
        fillRate,               // Taux de remplissage en pourcentage
      };

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL différencié selon la période:
        // - Périodes passées: 6 heures (données historiques stables)
        // - Période actuelle: 1 heure (peut changer avec nouveaux RDV)
        // - Périodes futures: 2 heures (planification qui évolue)
        const now = new Date();
        const isPastPeriod = end < now;
        const isCurrentPeriod = start <= now && end >= now;
        
        let ttl: number;
        if (isPastPeriod) {
          ttl = 6 * 60 * 60; // 6 heures pour les périodes passées
        } else if (isCurrentPeriod) {
          ttl = 60 * 60; // 1 heure pour la période actuelle
        } else {
          ttl = 2 * 60 * 60; // 2 heures pour les périodes futures
        }
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getWeeklyFillRate:', cacheError);
      }

      return result;

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
   * Calcule le taux d'annulation global de tous les rendez-vous du salon avec cache Redis
   * @param userId - ID du salon/utilisateur
   * @returns Objet contenant le taux d'annulation global et les détails
   */
  async getGlobalCancellationRate(userId: string) {
    try {
      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:global-cancellation:${userId}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getGlobalCancellationRate:', cacheError);
      }

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
        ? Math.round((cancelledAppointments / totalAppointments) * 100 * 100) /  100 
        : 0; // Éviter la division par zéro

      // Calculer le taux de confirmation
      const confirmationRate = totalAppointments > 0 
        ? Math.round((confirmedAppointments / totalAppointments) * 100 * 100) / 100 
        : 0;

      // ==================== ÉTAPE 4: RETOUR DES RÉSULTATS GLOBAUX ====================
      const result = {
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

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL de 2 heures pour les statistiques globales
        // Ces données changent moins fréquemment et sont coûteuses à calculer
        const ttl = 2 * 60 * 60; // 2 heures
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getGlobalCancellationRate:', cacheError);
      }

      return result;

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
   * Calcule la somme des prix des rendez-vous payés pour un mois donné avec cache Redis
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

      // ==================== CACHE: VÉRIFIER LE CACHE REDIS ====================
      const cacheKey = `dashboard:monthly-paid:${userId}:${year}-${month.toString().padStart(2, '0')}`;
      
      try {
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getTotalPaidAppointmentsByMonth:', cacheError);
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
      const result = {
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

      // ==================== CACHE: SAUVEGARDER EN CACHE ====================
      try {
        // TTL différencié selon le mois:
        // - Mois passés: 24 heures (données historiques très stables)
        // - Mois actuel: 1 heure (peut changer avec nouveaux paiements)
        // - Mois futurs: 4 heures (paiements anticipés possibles)
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        
        let ttl: number;
        if (year < currentYear || (year === currentYear && month < currentMonth)) {
          ttl = 24 * 60 * 60; // 24 heures pour les mois passés
        } else if (year === currentYear && month === currentMonth) {
          ttl = 60 * 60; // 1 heure pour le mois actuel
        } else {
          ttl = 4 * 60 * 60; // 4 heures pour les mois futurs
        }
        
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getTotalPaidAppointmentsByMonth:', cacheError);
      }

      return result;

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

  //! DEMANDE DE RDV

  //! ------------------------------------------------------------------------------
  async createAppointmentRequest(dto: CreateAppointmentRequestDto) {

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
}