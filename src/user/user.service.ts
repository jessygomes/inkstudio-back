import {Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CachedUser } from 'utils/type';
// import { User, Prisma } from '@prisma/client';

@Injectable()
export class UserService {
  // Injecter le service Prisma dans le service User
  constructor(private prisma: PrismaService, 
    private cacheService: CacheService) {}

  async getUsers(
    query?: string,
    city?: string,
    style?: string,
    page: number = 1,
    limit: number = 1
  ) {
    try {
      // Sanitize pagination
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(limit) || 12));
      const skip = (currentPage - 1) * perPage;

      // Créer une clé de cache basée sur les paramètres
      const cacheKey = `users:list:${JSON.stringify({
        query: query?.trim() || null,
        city: city?.trim() || null,
        style: style?.trim() || null,
        page: currentPage,
        limit: perPage
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        users: any[];
        pagination: any;
        filters: any;
      }>(cacheKey);
      
      if (cachedResult) {
        console.log(`✅ Liste des users trouvée dans Redis pour la page ${currentPage}`);
        return cachedResult;
      }

      // Build where
      let where: Record<string, any> | undefined = {};
      if (query && query.trim() !== "") {
        where.OR = [
          { salonName: { contains: query, mode: "insensitive" as const } },
          { Tatoueur: { some: { name: { contains: query, mode: "insensitive" as const } } } },
        ];
      }
      if (city && city.trim() !== "") {
        // Combine avec OR précédent => AND global, c'est ce qu'on veut
        where.city = { contains: city, mode: "insensitive" as const };
      }
      if (style && typeof style === 'string' && style.trim() !== '') {
        where.Tatoueur = {
          some: {
            style: { has: style.trim() }
          }
        };
      }
      if (where && Object.keys(where).length === 0) where = undefined;

      // Count + Data en transaction
      const [totalUsers, users] = await this.prisma.$transaction([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            salonName: true,
            image: true,
            firstName: true,
            lastName: true,
            phone: true,
            address: true,
            city: true,
            postalCode: true,
            salonHours: true,
            prestations: true,
            Tatoueur: {
              select: {
                id: true,
                name: true,
                img: true,
                description: true,
                phone: true,
                hours: true,
                instagram: true,
                style: true,
                skills: true,
                rdvBookingEnabled: true
              },
            },
            salonPhotos: true,
            instagram: true,
            facebook: true,
            tiktok: true,
            website: true,
          },
          orderBy: { salonName: "asc" }, // adapte selon ton besoin
          skip,
          take: perPage,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalUsers / perPage));
      const startIndex = totalUsers === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + perPage, totalUsers);

      const result = {
        error: false,
        users,
        pagination: {
          currentPage,
          limit: perPage,
          totalUsers,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
          startIndex,
          endIndex,
        },
        filters: { query: query ?? null, city: city ?? null },
      };

      // 3. Mettre en cache (TTL 5 minutes pour les listes avec filtres)
      await this.cacheService.set(cacheKey, result, 300);
      console.log(`💾 Liste des users mise en cache pour la page ${currentPage}`);

      return result;
    } catch (error) {
      console.error("Error fetching users:", error);
      throw new Error("Unable to fetch users");
    }
  }

    //! SEARCH USERS (pour la barre de recherche du front)
    async searchUsers(query: string) {
      if (!query || query.trim() === "") {
        // Si pas de query, retourner tout
        return await this.getUsers();
      }
      // Recherche insensible à la casse sur plusieurs champs
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { salonName: { contains: query, mode: "insensitive" } },
            { Tatoueur: { some: { name: { contains: query, mode: "insensitive" as const } } } },
          ],
        },
        select: {
          id: true,
          email: true,
          salonName: true,
          image: true,
          firstName: true,
          lastName: true,
          phone: true,
          address: true,
          city: true,
          postalCode: true,
          salonHours: true,
          prestations: true,
          Tatoueur: {
            select: {
              id: true,
              name: true,
              img: true,
              description: true,
              phone: true,
              hours: true,
              style: true,
              skills: true,
              rdvBookingEnabled: true
            }
          },
          salonPhotos: true,
          instagram: true,
          facebook: true,
          tiktok: true,
          website: true,
        },
      });
      return users;
    }

  //! RECUPERER LES VILLES
  async getDistinctCities() {
  const rows = await this.prisma.user.findMany({
    distinct: ["city"],
    where: { city: { not: null } },
    select: { city: true },
    orderBy: { city: "asc" },
  });
  return rows
    .map(r => r.city?.trim())
    .filter(Boolean);
  }

  //! RECUPERER LES STYLES
  async getDistinctStyles(): Promise<string[]> {
    const rows: { style: string[] }[] = await this.prisma.tatoueur.findMany({
      select: { style: true },
    });
    const allStyles: string[] = rows.flatMap(r => Array.isArray(r.style) ? r.style : []);
    return Array.from(new Set(allStyles.map(s => s.trim()).filter(Boolean))).sort();
  }

  //! GET USER BY SLUG + LOCALISATION
  async getUserBySlugAndLocation({ nameSlug, locSlug }: { nameSlug: string; locSlug: string }) {
    try {
      // Créer une clé de cache basée sur les slugs
      const cacheKey = `user:slug:${nameSlug}:${locSlug}`;

      // 1. Vérifier dans Redis
      try {
        const cachedUser = await this.cacheService.get(cacheKey);
        if (cachedUser) {
          console.log(`✅ User avec slug ${nameSlug}/${locSlug} trouvé dans Redis`);
          return cachedUser;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getUserBySlugAndLocation:', cacheError);
        // Continue sans cache si Redis est indisponible
      }

      // 2. Sinon, aller chercher en DB - On récupère tous les salons dont le slug du nom correspond
      const users = await this.prisma.user.findMany({
        where: {
          salonName: { not: null },
          city: { not: null },
          postalCode: { not: null },
        },
        select: {
          id: true,
          email: true,
          salonName: true,
          description: true,
          image: true,
          firstName: true,
          lastName: true,
          phone: true,
          address: true,
          city: true,
          postalCode: true,
          salonHours: true,
          prestations: true,
          appointmentBookingEnabled: true,
          Tatoueur: {
            select: {
              id: true,
              name: true,
              img: true,
              description: true,
              phone: true,
              hours: true,
              instagram: true,
              style: true,
              skills: true,
              rdvBookingEnabled: true
            }
          },
          salonPhotos: true,
          instagram: true,
          facebook: true,
          tiktok: true,
          website: true,
          Portfolio: {
            select: {
              id: true,
              title: true,
              description: true,
              imageUrl: true,
              tatoueurId: true,
              createdAt: true,
              updatedAt: true,
            }
          },
          ProductSalon: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              imageUrl: true,
              createdAt: true,
              updatedAt: true,
            }
          },
        },
      });

      // On filtre côté JS pour matcher les deux slugs
      const toSlug = (str: string) => str
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      
      const found = users.find(u => {
        const name = toSlug(u.salonName || '');
        const locSource = [u.city, u.postalCode].filter(v => typeof v === 'string' && v.trim() !== '').join('-');
        const loc = toSlug(locSource) || 'localisation';
        return name === nameSlug && loc === locSlug;
      });

      // 3. Mettre en cache le résultat (TTL 2 heures - les données salon changent peu)
      try {
        const ttl = 2 * 60 * 60; // 2 heures
        await this.cacheService.set(cacheKey, found, ttl);
        console.log(`💾 User avec slug ${nameSlug}/${locSlug} mis en cache`);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getUserBySlugAndLocation:', cacheError);
        // Continue même si la mise en cache échoue
      }

      return found || null;
    } catch (error) {
      console.error('Erreur dans getUserBySlugAndLocation:', error);
      throw error;
    }
  }

  //! GET USER BY ID
  async getUserById({userId} : {userId: string}) {
    const cacheKey = `user:${userId}`;

    // 1. Vérifier dans Redis
    const cachedUser = await this.cacheService.get<CachedUser>(cacheKey);
    
    if (cachedUser) {
      console.log(`✅ User ${userId} trouvé dans Redis`);
      return cachedUser;
    }

    // 2. Sinon, aller chercher en DB
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        saasPlan: true,
        email: true,
        salonName: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        postalCode: true,
        salonHours: true,
        instagram: true,
        facebook: true,
        tiktok: true,
        website: true,
        description: true,
        image: true,
        role: true,
        prestations: true,
        Tatoueur: {
          select: {
            id: true,
            name: true,
            img: true,
            description: true,
            phone: true,
            hours: true,
            instagram: true,
            style: true,
            skills: true,
            rdvBookingEnabled: true
          }
        }
      },
    })

    return user;
  }

    //! GET PHOTOS SALON
  async getPhotosSalon({userId} : {userId: string}) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        salonPhotos: true,
      },
    });

    if (!user) {
      throw new Error('Utilisateur introuvable');
    }

    return {
      salonPhotos: (user.salonPhotos as string[] | undefined) ?? [],
    };
  }

  //! UPDATE USER
  async updateUser({userId, userBody} : {userId: string; userBody: { salonName: string; firstName: string; lastName: string; phone: string; address: string; city: string; postalCode: string; instagram: string; facebook: string; tiktok: string; website: string; description: string; image: string; prestations?: string[]; }}) {

  const allowed = new Set(["TATTOO", "RETOUCHE", "PROJET", "PIERCING"]);
  const safePrestations = Array.isArray(userBody.prestations)
    ? userBody.prestations
        .map(p => typeof p === 'string' ? p.toUpperCase().trim() : '')
        .filter(p => allowed.has(p))
    : [];

    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        salonName: userBody.salonName,
        firstName: userBody.firstName,
        lastName: userBody.lastName,
        phone: userBody.phone,
        address: userBody.address,
        city: userBody.city,
        postalCode: userBody.postalCode,
        instagram: userBody.instagram,
        facebook: userBody.facebook,
        tiktok: userBody.tiktok,
        website: userBody.website,
        description: userBody.description,
        image: userBody.image, // Assurez-vous que l'image est gérée correctement
        prestations: safePrestations
      },
    });

    // Invalider le cache après update
    await this.cacheService.del(`user:${userId}`);
    // Invalider aussi tous les caches de listes d'utilisateurs
    this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug qui pourraient être affectés
    this.cacheService.delPattern('user:slug:*');

    return user;
  }

  //! UPDATE HOURS SALON
  async updateHoursSalon({userId, salonHours} : {userId: string; salonHours: string}) {
    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        salonHours: salonHours,
      },
    });

    // Invalider le cache après update
    await this.cacheService.del(`user:${userId}`);
    this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug car les horaires peuvent affecter l'affichage
    this.cacheService.delPattern('user:slug:*');

    return user;
  }

  //! ADD OR UPDATE PHOTO SALON
  async addOrUpdatePhotoSalon({userId, salonPhotos} : {userId: string; salonPhotos: string[] | {photoUrls: string[]}}) {
    // Gérer le cas où salonPhotos est un objet avec photoUrls ou directement un tableau
    let photosArray: string[];
    
    if (Array.isArray(salonPhotos)) {
      photosArray = salonPhotos;
    } else if (salonPhotos && typeof salonPhotos === 'object' && 'photoUrls' in salonPhotos) {
      photosArray = (salonPhotos as {photoUrls: string[]}).photoUrls;
    } else {
      throw new Error('Format de données invalide. Attendu: tableau de strings ou objet avec photoUrls.');
    }

    // Vérifier que photosArray est bien un tableau
    if (!Array.isArray(photosArray)) {
      throw new Error('Les photos doivent être fournies sous forme de tableau.');
    }

    // Limiter à maximum 6 photos
    const maxPhotos = 6;
    const limitedPhotos = photosArray.slice(0, maxPhotos);

    if (photosArray.length > maxPhotos) {
      throw new Error(`Vous ne pouvez ajouter que ${maxPhotos} photos maximum. ${photosArray.length} photos ont été fournies.`);
    }

    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        salonPhotos: {
          set: limitedPhotos,
        },
      },
    });

    // Invalider le cache après update
    await this.cacheService.del(`user:${userId}`);
    this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug car les photos peuvent affecter l'affichage
    this.cacheService.delPattern('user:slug:*');

    console.log("Salon photos updated:", limitedPhotos);
    return user;
  }

  //! ------------------------------------------------------------------------------

  //! RECUPERER LE PARAMÈTRE DE CONFIRMATION DES RDV

  //! ------------------------------------------------------------------------------
  async getConfirmationSetting({userId}: {userId: string}) {
    try {
      const cacheKey = `user:confirmation:${userId}`;

      // 1. Vérifier dans Redis
      const cachedSetting = await this.cacheService.get<{addConfirmationEnabled: boolean}>(cacheKey);
      
      if (cachedSetting) {
        console.log(`✅ Confirmation setting pour user ${userId} trouvé dans Redis`);
        return {
          error: false,
          user: cachedSetting,
        };
      }

      // 2. Sinon, aller chercher en DB
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          addConfirmationEnabled: true,
        },
      });

      // 3. Mettre en cache (TTL 1 heure pour les settings)
      if (user) {
        await this.cacheService.set(cacheKey, user, 3600);
        console.log(`💾 Confirmation setting pour user ${userId} mis en cache`);
      }

      return {
        error: false,
        user,
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

  //! METTRE À JOUR LE PARAMÈTRE DE CONFIRMATION DES RDV

  //! ------------------------------------------------------------------------------
  async updateConfirmationSetting({userId, addConfirmationEnabled}: {userId: string, addConfirmationEnabled: boolean}) {
    console.log("userId dans le service:", userId, addConfirmationEnabled);
    try {
      const user = await this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          addConfirmationEnabled,
        },
        select: {
          id: true,
          addConfirmationEnabled: true,
          salonName: true,
        },
      });


      // Invalider le cache après update
      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.del(`user:confirmation:${userId}`);

      return {
        error: false,
        message: addConfirmationEnabled 
          ? 'Confirmation manuelle activée - Les nouveaux RDV devront être confirmés'
          : 'Confirmation automatique activée - Les nouveaux RDV seront directement confirmés',
        user,
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

  //! RECUPERER LE PARAMÈTRE DE CONFIRMATION DES RDV

  //! ------------------------------------------------------------------------------
  async getAppointmentBooking({userId}: {userId: string}) {
    try {
      const cacheKey = `user:appointment-booking:${userId}`;

      // 1. Vérifier dans Redis
      const cachedSetting = await this.cacheService.get<{appointmentBookingEnabled: boolean}>(cacheKey);
      
      if (cachedSetting) {
        console.log(`✅ Appointment booking setting pour user ${userId} trouvé dans Redis`);
        return {
          error: false,
          user: cachedSetting,
        };
      }

      // 2. Sinon, aller chercher en DB
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          appointmentBookingEnabled: true,
        },
      });

      // 3. Mettre en cache (TTL 1 heure pour les settings)
      if (user) {
        await this.cacheService.set(cacheKey, user, 3600);
        console.log(`💾 Appointment booking setting pour user ${userId} mis en cache`);
      }

      return {
        error: false,
        user,
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

  //! METTRE À JOUR LE PARAMÈTRE DE CONFIRMATION DES RDV

  //! ------------------------------------------------------------------------------
  async updateAppointmentBooking({userId, appointmentBookingEnabled}: {userId: string, appointmentBookingEnabled: boolean}) {
    console.log("userId dans le service:", userId, appointmentBookingEnabled);
    try {
      const user = await this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          appointmentBookingEnabled,
        },
        select: {
          id: true,
          appointmentBookingEnabled: true,
          salonName: true,
        },
      });

      // Invalider le cache après update
      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.del(`user:appointment-booking:${userId}`);

      return {
        error: false,
        message: appointmentBookingEnabled 
          ? 'Confirmation manuelle activée - Les nouveaux RDV devront être confirmés'
          : 'Confirmation automatique activée - Les nouveaux RDV seront directement confirmés',
        user,
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
