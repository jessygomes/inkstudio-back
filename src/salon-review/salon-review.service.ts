import { Injectable } from '@nestjs/common';
import { CreateSalonReviewDto } from './dto/create-salon-review.dto';
// import { UpdateSalonReviewDto } from './dto/update-salon-review.dto';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';

@Injectable()
export class SalonReviewService {
   constructor(private prisma: PrismaService, 
      private cacheService: CacheService) {}

//! ------------------------------------------------------------------------------
//! CRÉER UN AVIS SUR UN SALON (CLIENT CONNECTÉ)
//! ------------------------------------------------------------------------------
async createReview(createSalonReviewDto: CreateSalonReviewDto, clientUserId: string) {
  try {
    const { salonId, appointmentId, rating, title, comment, photos } = createSalonReviewDto;

    // 1. Vérifier que l'utilisateur est bien un client
    const client = await this.prisma.user.findUnique({
      where: { id: clientUserId },
      select: { 
        role: true,
        firstName: true,
        lastName: true 
      }
    });

    if (!client || client.role !== 'client') {
      return {
        error: true,
        message: 'Seuls les clients peuvent laisser des avis.'
      };
    }

    // 2. Vérifier que le salon existe
    const salon = await this.prisma.user.findUnique({
      where: { id: salonId },
      select: { 
        role: true,
        salonName: true 
      }
    });

    if (!salon || salon.role !== 'user') {
      return {
        error: true,
        message: 'Salon introuvable.'
      };
    }

    // 3. Vérifier que le client ne laisse pas un avis à lui-même
    if (clientUserId === salonId) {
      return {
        error: true,
        message: 'Vous ne pouvez pas laisser un avis sur votre propre profil.'
      };
    }

    // 4. Vérifier qu'il existe au moins un RDV terminé entre ce client et ce salon
    const completedAppointments = await this.prisma.appointment.findMany({
      where: {
        clientUserId: clientUserId,
        userId: salonId,
        status: 'COMPLETED'
      },
      select: {
        id: true,
        start: true,
        prestation: true
      },
      orderBy: {
        start: 'desc'
      }
    });

    if (!completedAppointments || completedAppointments.length === 0) {
      return {
        error: true,
        message: 'Vous devez avoir au moins un rendez-vous terminé avec ce salon pour laisser un avis.'
      };
    }

    // 5. Si un appointmentId est fourni, vérifier qu'il existe et qu'il est terminé
    if (appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          status: true,
          clientUserId: true,
          userId: true
        }
      });

      if (!appointment) {
        return {
          error: true,
          message: 'Rendez-vous introuvable.'
        };
      }

      if (appointment.clientUserId !== clientUserId) {
        return {
          error: true,
          message: 'Ce rendez-vous ne vous appartient pas.'
        };
      }

      if (appointment.userId !== salonId) {
        return {
          error: true,
          message: 'Ce rendez-vous n\'est pas associé à ce salon.'
        };
      }

      if (appointment.status !== 'COMPLETED') {
        return {
          error: true,
          message: 'Vous ne pouvez laisser un avis que pour un rendez-vous terminé.'
        };
      }

      // Vérifier qu'il n'y a pas déjà un avis pour ce RDV
      const existingReview = await this.prisma.salonReview.findUnique({
        where: { appointmentId: appointmentId }
      });

      if (existingReview) {
        return {
          error: true,
          message: 'Un avis existe déjà pour ce rendez-vous.'
        };
      }
    }

    // 6. Vérifier que le client n'a pas déjà laissé un avis sans appointmentId pour ce salon
    if (!appointmentId) {
      const existingGeneralReview = await this.prisma.salonReview.findFirst({
        where: {
          authorId: clientUserId,
          salonId: salonId,
          appointmentId: null
        }
      });

      if (existingGeneralReview) {
        return {
          error: true,
          message: 'Vous avez déjà laissé un avis général pour ce salon. Vous pouvez laisser un avis spécifique à un rendez-vous.'
        };
      }
    }

    // 7. Créer l'avis
    const review = await this.prisma.salonReview.create({
      data: {
        authorId: clientUserId,
        salonId: salonId,
        appointmentId: appointmentId || null,
        rating,
        title: title || null,
        comment: comment || null,
        photos: photos || [],
        isVerified: !!appointmentId, // Vérifié si associé à un RDV
        isVisible: true
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            image: true
          }
        },
        salon: {
          select: {
            id: true,
            salonName: true
          }
        },
        appointment: {
          select: {
            id: true,
            prestation: true,
            start: true
          }
        }
      }
    });

    // 8. Invalider les caches liés au salon
    await this.cacheService.del(`salon:reviews:${salonId}`);
    this.cacheService.delPattern(`salon:reviews:${salonId}:*`);
    this.cacheService.delPattern(`client:reviews:${clientUserId}:*`);

    return {
      error: false,
      message: 'Avis créé avec succès.',
      review
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Erreur lors de la création de l\'avis:', errorMessage);
    return {
      error: true,
      message: 'Une erreur est survenue lors de la création de l\'avis.'
    };
  }
}

//! ------------------------------------------------------------------------------
//! RÉCUPÉRER TOUS LES AVIS D'UN SALON AVEC PAGINATION
//! ------------------------------------------------------------------------------
async findAllReviewBySalon(
  salonId: string, 
  page: number = 1, 
  limit: number = 10,
  sortBy: 'recent' | 'rating' | 'oldest' = 'recent',
  filterRating?: number
) {
  try {
    // Sanitize pagination
    const currentPage = Math.max(1, Number(page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
    const skip = (currentPage - 1) * perPage;

    // Créer une clé de cache basée sur les paramètres
    const cacheKey = `salon:reviews:${salonId}:${JSON.stringify({
      page: currentPage,
      limit: perPage,
      sortBy,
      filterRating: filterRating || null
    })}`;

    // 1. Vérifier dans Redis
    try {
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        reviews: Array<Record<string, unknown>>;
        statistics: Record<string, unknown>;
        pagination: Record<string, unknown>;
      }>(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }
    } catch (cacheError) {
      console.warn('Erreur cache Redis pour findAllReviewBySalon:', cacheError);
    }

    // 2. Vérifier que le salon existe
    const salon = await this.prisma.user.findUnique({
      where: { id: salonId },
      select: { 
        role: true,
        salonName: true 
      }
    });

    // if (!salon || salon.role !== 'user') {
    //   return {
    //     error: true,
    //     message: 'Salon introuvable.'
    //   };
    // }

    if (!salon) {
      return {
        error: true,
        message: 'Salon introuvable.'
      };
    }

    // 3. Construire les conditions de recherche
    const whereClause: Record<string, unknown> = {
      salonId: salonId,
      isVisible: true // Seulement les avis visibles
    };

    // Filtrer par note si spécifié
    if (filterRating && filterRating >= 1 && filterRating <= 5) {
      whereClause.rating = filterRating;
    }

    // 4. Déterminer l'ordre de tri
    let orderBy: Record<string, string> | Array<Record<string, string>> = { createdAt: 'desc' }; // Par défaut: plus récent
    
    if (sortBy === 'rating') {
      orderBy = [
        { rating: 'desc' },
        { createdAt: 'desc' }
      ];
    } else if (sortBy === 'oldest') {
      orderBy = { createdAt: 'asc' };
    }

    // 5. Récupérer le total et les avis avec pagination en une transaction
    const [totalReviews, reviews, allReviews] = await this.prisma.$transaction([
      // Compter le total d'avis
      this.prisma.salonReview.count({ where: whereClause }),
      
      // Récupérer les avis paginés
      this.prisma.salonReview.findMany({
        where: whereClause,
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              image: true,
              clientProfile: {
                select: {
                  pseudo: true
                }
              }
            }
          },
          appointment: {
            select: {
              id: true,
              prestation: true,
              start: true
            }
          }
        },
        orderBy,
        skip,
        take: perPage
      }),
      
      // Récupérer tous les avis pour les statistiques
      this.prisma.salonReview.findMany({
        where: {
          salonId: salonId,
          isVisible: true
        },
        select: {
          rating: true,
          isVerified: true
        }
      })
    ]);

    // 6. Calculer les statistiques
    const totalRatings = allReviews.length;
    const averageRating = totalRatings > 0 
      ? allReviews.reduce((sum, review) => sum + review.rating, 0) / totalRatings 
      : 0;

    // Calculer la distribution des notes
    const ratingDistribution = {
      5: allReviews.filter(r => r.rating === 5).length,
      4: allReviews.filter(r => r.rating === 4).length,
      3: allReviews.filter(r => r.rating === 3).length,
      2: allReviews.filter(r => r.rating === 2).length,
      1: allReviews.filter(r => r.rating === 1).length
    };

    // Compter les avis vérifiés (depuis allReviews qui contient déjà isVerified)
    const verifiedReviewsCount = allReviews.filter(r => r.isVerified).length;

    // 7. Formater les avis
    const formattedReviews = reviews.map(review => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      photos: review.photos,
      isVerified: review.isVerified,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      salonResponse: review.salonResponse,
      salonRespondedAt: review.salonRespondedAt,
      author: {
        id: review.author.id,
        name: review.author.clientProfile?.pseudo || 
              `${review.author.firstName || ''} ${review.author.lastName || ''}`.trim() || 
              'Client anonyme',
        image: review.author.image
      },
      appointment: review.appointment ? {
        id: review.appointment.id,
        prestation: review.appointment.prestation,
        date: review.appointment.start
      } : null
    }));

    // 8. Calculer les informations de pagination
    const totalPages = Math.ceil(totalReviews / perPage);
    const startIndex = totalReviews === 0 ? 0 : skip + 1;
    const endIndex = Math.min(skip + perPage, totalReviews);

    const result = {
      error: false,
      reviews: formattedReviews,
      statistics: {
        totalReviews: totalRatings,
        averageRating: Math.round(averageRating * 10) / 10, // Arrondi à 1 décimale
        ratingDistribution,
        verifiedReviewsCount
      },
      pagination: {
        currentPage,
        limit: perPage,
        totalReviews,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
        startIndex,
        endIndex
      }
    };

    // 9. Mettre en cache (TTL 10 minutes)
    try {
      const ttl = 10 * 60; // 10 minutes
      await this.cacheService.set(cacheKey, result, ttl);
    } catch (cacheError) {
      console.warn('Erreur sauvegarde cache Redis pour findAllReviewBySalon:', cacheError);
    }

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Erreur lors de la récupération des avis:', errorMessage);
    return {
      error: true,
      message: 'Une erreur est survenue lors de la récupération des avis.'
    };
  }
}

  //! ------------------------------------------------------------------------------
  //! RÉCUPÉRER TOUS LES AVIS DONNÉS PAR UN CLIENT AVEC PAGINATION
  //! ------------------------------------------------------------------------------
  async findAllReviewsByClient(
    clientUserId: string, 
    page: number = 1, 
    limit: number = 10,
    sortBy: 'recent' | 'rating' | 'oldest' = 'recent'
  ) {
    try {
      // Sanitize pagination
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      // Créer une clé de cache basée sur les paramètres
      const cacheKey = `client:reviews:${clientUserId}:${JSON.stringify({
        page: currentPage,
        limit: perPage,
        sortBy
      })}`;

      // 1. Vérifier dans Redis
      try {
        const cachedResult = await this.cacheService.get<{
          error: boolean;
          reviews: Array<Record<string, unknown>>;
          statistics: Record<string, unknown>;
          pagination: Record<string, unknown>;
        }>(cacheKey);
        
        if (cachedResult) {
          return cachedResult;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour findAllReviewsByClient:', cacheError);
      }

      // 2. Vérifier que l'utilisateur existe et est bien un client
      const client = await this.prisma.user.findUnique({
        where: { id: clientUserId },
        select: { 
          role: true,
          firstName: true,
          lastName: true,
          clientProfile: {
            select: {
              pseudo: true
            }
          }
        }
      });

      if (!client || client.role !== 'client') {
        return {
          error: true,
          message: 'Client introuvable.'
        };
      }

      // 3. Construire les conditions de recherche
      const whereClause: Record<string, unknown> = {
        authorId: clientUserId
      };

      // 4. Déterminer l'ordre de tri
      let orderBy: Record<string, string> | Array<Record<string, string>> = { createdAt: 'desc' }; // Par défaut: plus récent
      
      if (sortBy === 'rating') {
        orderBy = [
          { rating: 'desc' },
          { createdAt: 'desc' }
        ];
      } else if (sortBy === 'oldest') {
        orderBy = { createdAt: 'asc' };
      }

      // 5. Récupérer le total et les avis avec pagination en une transaction
      const [totalReviews, reviews, allReviews] = await this.prisma.$transaction([
        // Compter le total d'avis
        this.prisma.salonReview.count({ where: whereClause }),
        
        // Récupérer les avis paginés
        this.prisma.salonReview.findMany({
          where: whereClause,
          include: {
            salon: {
              select: {
                id: true,
                salonName: true,
                city: true,
                postalCode: true,
                image: true
              }
            },
            appointment: {
              select: {
                id: true,
                prestation: true,
                start: true
              }
            }
          },
          orderBy,
          skip,
          take: perPage
        }),
        
        // Récupérer tous les avis pour les statistiques
        this.prisma.salonReview.findMany({
          where: whereClause,
          select: {
            rating: true,
            isVerified: true,
            isVisible: true
          }
        })
      ]);

      // 6. Calculer les statistiques
      const totalRatings = allReviews.length;
      const averageRatingGiven = totalRatings > 0 
        ? allReviews.reduce((sum, review) => sum + review.rating, 0) / totalRatings 
        : 0;

      // Calculer la distribution des notes données
      const ratingDistribution = {
        5: allReviews.filter(r => r.rating === 5).length,
        4: allReviews.filter(r => r.rating === 4).length,
        3: allReviews.filter(r => r.rating === 3).length,
        2: allReviews.filter(r => r.rating === 2).length,
        1: allReviews.filter(r => r.rating === 1).length
      };

      // Compter les avis vérifiés et visibles
      const verifiedReviewsCount = allReviews.filter(r => r.isVerified).length;
      const visibleReviewsCount = allReviews.filter(r => r.isVisible).length;

      // 7. Formater les avis
      const formattedReviews = reviews.map(review => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        photos: review.photos,
        isVerified: review.isVerified,
        isVisible: review.isVisible,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        salonResponse: review.salonResponse,
        salonRespondedAt: review.salonRespondedAt,
        salon: {
          id: review.salon.id,
          salonName: review.salon.salonName,
          city: review.salon.city,
          postalCode: review.salon.postalCode,
          image: review.salon.image
        },
        appointment: review.appointment ? {
          id: review.appointment.id,
          prestation: review.appointment.prestation,
          date: review.appointment.start
        } : null
      }));

      // 8. Calculer les informations de pagination
      const totalPages = Math.ceil(totalReviews / perPage);
      const startIndex = totalReviews === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + perPage, totalReviews);

      const result = {
        error: false,
        reviews: formattedReviews,
        statistics: {
          totalReviews: totalRatings,
          averageRatingGiven: Math.round(averageRatingGiven * 10) / 10, // Arrondi à 1 décimale
          ratingDistribution,
          verifiedReviewsCount,
          visibleReviewsCount
        },
        pagination: {
          currentPage,
          limit: perPage,
          totalReviews,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
          startIndex,
          endIndex
        }
      };

      // 9. Mettre en cache (TTL 10 minutes)
      try {
        const ttl = 10 * 60; // 10 minutes
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour findAllReviewsByClient:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des avis du client:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des avis.'
      };
    }
  }

  //! ------------------------------------------------------------------------------
  //! MODIFIER LA VISIBILITÉ D'UN AVIS (SALON)
  //! ------------------------------------------------------------------------------
  async updateReviewVisibility(
    reviewId: string,
    salonUserId: string,
    isVisible: boolean
  ) {
    try {
      // 1. Récupérer l'avis et vérifier qu'il appartient au salon connecté
      const review = await this.prisma.salonReview.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          salonId: true,
          authorId: true,
          isVisible: true
        }
      });

      if (!review) {
        return {
          error: true,
          message: 'Avis introuvable.'
        };
      }

      if (review.salonId !== salonUserId) {
        return {
          error: true,
          message: "Vous n'êtes pas autorisé à modifier cet avis."
        };
      }

      // 2. Vérifier s'il y a un changement
      if (review.isVisible === isVisible) {
        return {
          error: false,
          message: `La visibilité est déjà ${isVisible ? 'activée' : 'désactivée'}.`
        };
      }

      // 3. Mettre à jour la visibilité
      const updatedReview = await this.prisma.salonReview.update({
        where: { id: reviewId },
        data: { isVisible }
      });

      // 4. Invalider les caches liés au salon et au client auteur
      await this.cacheService.del(`salon:reviews:${salonUserId}`);
      this.cacheService.delPattern(`salon:reviews:${salonUserId}:*`);
      this.cacheService.delPattern(`client:reviews:${review.authorId}:*`);

      return {
        error: false,
        message: `Visibilité de l'avis mise à jour (${isVisible ? 'visible' : 'masqué'}).`,
        review: updatedReview
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error("Erreur lors de la mise à jour de la visibilité de l'avis:", errorMessage);
      return {
        error: true,
        message: "Une erreur est survenue lors de la mise à jour de la visibilité de l'avis."
      };
    }
  }

  //! ------------------------------------------------------------------------------
  //! SUPPRIMER UN AVIS (CLIENT AUTEUR)
  //! ------------------------------------------------------------------------------
  async deleteReviewByClient(reviewId: string, clientUserId: string) {
    try {
      // 1. Vérifier l'existence et la propriété de l'avis
      const review = await this.prisma.salonReview.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          authorId: true,
          salonId: true,
          appointmentId: true
        }
      });

      if (!review) {
        return {
          error: true,
          message: 'Avis introuvable.'
        };
      }

      if (review.authorId !== clientUserId) {
        return {
          error: true,
          message: "Vous n'êtes pas autorisé à supprimer cet avis."
        };
      }

      // 2. Supprimer l'avis
      await this.prisma.salonReview.delete({ where: { id: reviewId } });

      // 3. Invalider les caches liés au salon et au client
      await this.cacheService.del(`salon:reviews:${review.salonId}`);
      this.cacheService.delPattern(`salon:reviews:${review.salonId}:*`);
      this.cacheService.delPattern(`client:reviews:${clientUserId}:*`);

      return {
        error: false,
        message: 'Avis supprimé avec succès.'
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la suppression de l\'avis:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la suppression de l\'avis.'
      };
    }
  }

  //! ------------------------------------------------------------------------------
  //! RÉCUPÉRER LES DERNIERS AVIS RÉCENTS (< 10 JOURS) D'UN SALON
  //! ------------------------------------------------------------------------------
  async getRecentReviewsBySalon(salonId: string, limit: number = 5) {
    try {
      // Sanitize limit
      const maxReviews = Math.min(20, Math.max(1, Number(limit) || 5));

      // Créer une clé de cache
      const cacheKey = `salon:recent-reviews:${salonId}:${maxReviews}`;

      // 1. Vérifier dans Redis
      try {
        const cachedResult = await this.cacheService.get<{
          error: boolean;
          reviews: Array<Record<string, unknown>>;
          message: string;
        }>(cacheKey);
        
        if (cachedResult) {
          return cachedResult;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getRecentReviewsBySalon:', cacheError);
      }

      // 2. Vérifier que le salon existe
      const salon = await this.prisma.user.findUnique({
        where: { id: salonId },
        select: { 
          role: true,
          salonName: true 
        }
      });

      // if (!salon || salon.role !== 'user') {
      //   return {
      //     error: true,
      //     message: 'Salon introuvable.'
      //   };
      // }

      if (!salon) {
        return {
          error: true,
          message: 'Salon introuvable.'
        };
      }

      // 3. Calculer la date limite (il y a 10 jours)
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      // 4. Récupérer les avis récents et visibles
      const reviews = await this.prisma.salonReview.findMany({
        where: {
          salonId: salonId,
          isVisible: true,
          createdAt: {
            gte: tenDaysAgo
          }
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              image: true,
              clientProfile: {
                select: {
                  pseudo: true
                }
              }
            }
          },
          appointment: {
            select: {
              id: true,
              prestation: true,
              start: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: maxReviews
      });

      // 5. Formater les avis
      const formattedReviews = reviews.map(review => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        photos: review.photos,
        isVerified: review.isVerified,
        createdAt: review.createdAt,
        author: {
          id: review.author.id,
          name: review.author.clientProfile?.pseudo || 
                `${review.author.firstName || ''} ${review.author.lastName || ''}`.trim() || 
                'Client anonyme',
          image: review.author.image
        },
        appointment: review.appointment ? {
          id: review.appointment.id,
          prestation: review.appointment.prestation,
          date: review.appointment.start
        } : null,
        salonResponse: review.salonResponse,
        salonRespondedAt: review.salonRespondedAt
      }));

      const result = {
        error: false,
        reviews: formattedReviews,
        message: `${formattedReviews.length} avis récent(s) (< 10 jours) récupéré(s) avec succès.`
      };

      // 6. Mettre en cache (TTL 1 heure pour les avis récents)
      try {
        const ttl = 60 * 60; // 1 heure
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getRecentReviewsBySalon:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la récupération des avis récents:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la récupération des avis récents.'
      };
    }
  }

  //! ------------------------------------------------------------------------------
  //! RÉPONDRE À UN AVIS (SALON)
  //! ------------------------------------------------------------------------------
  async respondToReview(
    reviewId: string,
    salonUserId: string,
    response: string
  ) {
    try {
      // 1. Vérifier l'existence et la propriété de l'avis
      const review = await this.prisma.salonReview.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          salonId: true,
          authorId: true,
          salonResponse: true,
          salonRespondedAt: true
        }
      });

      if (!review) {
        return {
          error: true,
          message: 'Avis introuvable.'
        };
      }

      if (review.salonId !== salonUserId) {
        return {
          error: true,
          message: "Vous n'êtes pas autorisé à répondre à cet avis."
        };
      }

      // 2. Vérifier que la réponse n'est pas vide
      if (!response || response.trim() === '') {
        return {
          error: true,
          message: 'La réponse ne peut pas être vide.'
        };
      }

      // 3. Vérifier la longueur de la réponse
      if (response.length > 1000) {
        return {
          error: true,
          message: 'La réponse ne peut pas dépasser 1000 caractères.'
        };
      }

      // 4. Mettre à jour la réponse et la date
      const updatedReview = await this.prisma.salonReview.update({
        where: { id: reviewId },
        data: {
          salonResponse: response.trim(),
          salonRespondedAt: new Date()
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              image: true,
              clientProfile: {
                select: {
                  pseudo: true
                }
              }
            }
          }
        }
      });

      // 5. Invalider les caches liés au salon et au client auteur
      await this.cacheService.del(`salon:reviews:${salonUserId}`);
      this.cacheService.delPattern(`salon:reviews:${salonUserId}:*`);
      this.cacheService.delPattern(`salon:recent-reviews:${salonUserId}:*`);
      this.cacheService.delPattern(`client:reviews:${review.authorId}:*`);

      return {
        error: false,
        message: 'Réponse ajoutée avec succès.',
        review: {
          id: updatedReview.id,
          salonResponse: updatedReview.salonResponse,
          salonRespondedAt: updatedReview.salonRespondedAt,
          author: {
            id: updatedReview.author.id,
            name: updatedReview.author.clientProfile?.pseudo || 
                  `${updatedReview.author.firstName || ''} ${updatedReview.author.lastName || ''}`.trim() || 
                  'Client anonyme'
          }
        }
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de l\'ajout de la réponse à l\'avis:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de l\'ajout de la réponse.'
      };
    }
  }

  //! ------------------------------------------------------------------------------
  //! SUPPRIMER LA RÉPONSE D'UN SALON SUR UN AVIS
  //! ------------------------------------------------------------------------------
  async removeReviewResponse(reviewId: string, salonUserId: string) {
    try {
      // 1. Vérifier l'existence et la propriété de l'avis
      const review = await this.prisma.salonReview.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          salonId: true,
          authorId: true,
          salonResponse: true
        }
      });

      if (!review) {
        return {
          error: true,
          message: 'Avis introuvable.'
        };
      }

      if (review.salonId !== salonUserId) {
        return {
          error: true,
          message: "Vous n'êtes pas autorisé à modifier cet avis."
        };
      }

      // 2. Vérifier qu'il y a une réponse à supprimer
      if (!review.salonResponse) {
        return {
          error: false,
          message: 'Aucune réponse à supprimer.'
        };
      }

      // 3. Supprimer la réponse
      const updatedReview = await this.prisma.salonReview.update({
        where: { id: reviewId },
        data: {
          salonResponse: null,
          salonRespondedAt: null
        }
      });

      // 4. Invalider les caches liés au salon et au client auteur
      await this.cacheService.del(`salon:reviews:${salonUserId}`);
      this.cacheService.delPattern(`salon:reviews:${salonUserId}:*`);
      this.cacheService.delPattern(`salon:recent-reviews:${salonUserId}:*`);
      this.cacheService.delPattern(`client:reviews:${review.authorId}:*`);

      return {
        error: false,
        message: 'Réponse supprimée avec succès.',
        review: {
          id: updatedReview.id,
          salonResponse: updatedReview.salonResponse,
          salonRespondedAt: updatedReview.salonRespondedAt
        }
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Erreur lors de la suppression de la réponse à l\'avis:', errorMessage);
      return {
        error: true,
        message: 'Une erreur est survenue lors de la suppression de la réponse.'
      };
    }
  }
}
