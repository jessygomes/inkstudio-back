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
  async getUserBySlugAndLocation({ nameSlug, locSlug }: { nameSlug: string; locSlug: string }): Promise<Record<string, any> | null> {
    try {
      // Créer une clé de cache basée sur les slugs
      const cacheKey = `user:slug:${nameSlug}:${locSlug}`;

      // 1. Vérifier dans Redis
      try {
        const cachedUser = await this.cacheService.get(cacheKey);
        if (cachedUser) {
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
          colorProfile: true,
          colorProfileBis: true,
          saasPlan: true,
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
  async getUserById({userId} : {userId: string}): Promise<CachedUser | null> {
    const cacheKey = `user:${userId}`;

    // 1. Vérifier dans Redis
    const cachedUser = await this.cacheService.get<CachedUser>(cacheKey);
    
    if (cachedUser) {
      return cachedUser;
    }

    // 2. D'abord récupérer le rôle de l'utilisateur
    const userRole = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!userRole) {
      return null;
    }

    // 3. Récupérer les données selon le rôle
    let user;

    if (userRole.role === 'client') {
      // Pour les clients : données de base + profil client
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          image: true,
          role: true,
          updatedAt: true,
          clientProfile: {
            select: {
              id: true,
              pseudo: true,
              birthDate: true,
              city: true,
              postalCode: true,
              updatedAt: true
            }
          }
        }
      });
    } else {
      // Pour les salons : données existantes
      user = await this.prisma.user.findUnique({
        where: { id: userId },
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
        }
      });
    }

    // 4. Mettre en cache (TTL différent selon le rôle)
    if (user) {
      const ttl = userRole.role === 'client' ? 1800 : 3600; // 30min pour client, 1h pour salon
      await this.cacheService.set(cacheKey, user, ttl);
    }

    return user as CachedUser | null;
  }

    //! GET PHOTOS SALON
  async getPhotosSalon({userId} : {userId: string}): Promise<Record<string, any>> {
    try {
      // Créer une clé de cache spécifique pour les photos salon
      const cacheKey = `user:photos:${userId}`;

      // 1. Vérifier dans Redis
      try {
        const cachedPhotos = await this.cacheService.get<{salonPhotos: string[]}>(cacheKey);
        if (cachedPhotos) {
          return cachedPhotos;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getPhotosSalon:', cacheError);
        // Continue sans cache si Redis est indisponible
      }

      // 2. Sinon, aller chercher en DB
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

      const result = {
        salonPhotos: (user.salonPhotos as string[] | undefined) ?? [],
      };

      // 3. Mettre en cache (TTL 1 heure - les photos changent peu souvent)
      try {
        const ttl = 60 * 60; // 1 heure
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getPhotosSalon:', cacheError);
        // Continue même si la mise en cache échoue
      }

      return result;
    } catch (error) {
      console.error('Erreur dans getPhotosSalon:', error);
      throw error;
    }
  }

  //! UPDATE USER
  async updateUser({userId, userBody} : {userId: string; userBody: { salonName: string; firstName: string; lastName: string; phone: string; address: string; city: string; postalCode: string; instagram: string; facebook: string; tiktok: string; website: string; description: string; image: string; prestations?: string[]; }}): Promise<Record<string, any>> {
    
    // Vérifier que userId est défini
    if (!userId) {
      throw new Error('UserId est requis pour mettre à jour un utilisateur');
    }

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

  async updateUserClient({userId, userBody} : {userId: string; userBody: { firstName: string; lastName: string; phone: string; pseudo: string; city: string; postalCode: string; birthDate: string; image: string; }}): Promise<Record<string, any>> {
    // Vérifier que userId est défini
    if (!userId) {
      throw new Error('UserId est requis pour mettre à jour un utilisateur');
    }

    // Préparer les données pour la table User (champs de base)
    const userUpdateData: Record<string, any> = {
      firstName: userBody.firstName,
      lastName: userBody.lastName,
      phone: userBody.phone,
      image: userBody.image,
    };

    // Préparer les données pour la table ClientProfile
    const clientProfileData: Record<string, any> = {
      pseudo: userBody.pseudo,
      city: userBody.city,
      postalCode: userBody.postalCode,
      birthDate: userBody.birthDate ? new Date(userBody.birthDate) : null,
    };

    // Mettre à jour User et ClientProfile en une seule transaction
    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        ...userUpdateData,
        clientProfile: {
          upsert: {
            create: clientProfileData,
            update: clientProfileData
          }
        }
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        image: true,
        role: true,
        updatedAt: true,
        clientProfile: {
          select: {
            id: true,
            pseudo: true,
            birthDate: true,
            city: true,
            postalCode: true,
            updatedAt: true
          }
        }
      }
    });

    // Invalider le cache après update
    await this.cacheService.del(`user:${userId}`);
    this.cacheService.delPattern('users:list:*');
    this.cacheService.delPattern('user:slug:*');

    return user;
  }

  

  //! UPDATE HOURS SALON
  async updateHoursSalon({userId, salonHours} : {userId: string; salonHours: string}): Promise<Record<string, any>> {
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
  async addOrUpdatePhotoSalon({userId, salonPhotos} : {userId: string; salonPhotos: string[] | {photoUrls: string[]}}): Promise<Record<string, any>> {
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
    await this.cacheService.del(`user:photos:${userId}`); // Invalider spécifiquement le cache des photos
    this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug car les photos peuvent affecter l'affichage
    this.cacheService.delPattern('user:slug:*');
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

  //! ------------------------------------------------------------------------------

  //! RECUPERER LES COULEURS DU PROFIL

  //! ------------------------------------------------------------------------------
  async getColorProfile({userId}: {userId: string}) {
    try {
      const cacheKey = `user:color-profile:${userId}`;

      // 1. Vérifier dans Redis
      const cachedColorProfile = await this.cacheService.get<{colorProfile: string | null, colorProfileBis: string | null}>(cacheKey);
      
      if (cachedColorProfile) {
        return {
          error: false,
          user: cachedColorProfile,
        };
      }

      // 2. Sinon, aller chercher en DB
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          colorProfile: true,
          colorProfileBis: true,
        },
      });

      // 3. Mettre en cache (TTL 1 heure pour les couleurs)
      if (user) {
        await this.cacheService.set(cacheKey, user, 3600);
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

  //! RECUPERER LES FACTURES D'UN SALON

  //! ------------------------------------------------------------------------------
  async getFactureSalon({userId, page = 1, limit = 10, search = '', isPayed = ''}: {userId: string, page?: number, limit?: number, search?: string, isPayed?: string}) {
    try {
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      const cacheKey = `user:factures:${userId}:${JSON.stringify({
        page: currentPage,
        limit: perPage,
        search: search?.trim() || null,
        isPayed: isPayed?.trim() || null
      })}`;

      // 1. Vérifier dans Redis
      try {
        const cachedFactures = await this.cacheService.get<{
          error: boolean;
          factures: any[];
          statistics: any;
          pagination: any;
          message: string;
        }>(cacheKey);
        if (cachedFactures) {
          return cachedFactures;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getFactureSalon:', cacheError);
        // Continue sans cache si Redis est indisponible
      }

      // Construire les conditions de recherche
      const searchConditions = search && search.trim() !== ""
        ? {
            OR: [
              { 
                client: {
                  OR: [
                    { firstName: { contains: search, mode: "insensitive" as const } },
                    { lastName: { contains: search, mode: "insensitive" as const } },
                    { email: { contains: search, mode: "insensitive" as const } },
                  ]
                }
              },
              { title: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};

      // Construire les conditions de statut de paiement
      const paymentConditions = isPayed && isPayed.trim() !== ""
        ? isPayed.toLowerCase() === 'true' 
          ? { isPayed: true }
          : isPayed.toLowerCase() === 'false' 
          ? { isPayed: false }
          : {}
        : {};

      // 2. Compter le total des factures et récupérer les données avec pagination
      const whereClause = {
        userId,
        status: "COMPLETED" as const,
        prestation: {
          not: "PROJET" as const
        },
        // tattooDetail: {
        //   price: {
        //     gt: 0
        //   }
        // },
        ...searchConditions,
        ...paymentConditions
      };

      const [totalFactures, appointments, allAppointmentsForStats] = await this.prisma.$transaction([
        this.prisma.appointment.count({ where: whereClause }),
        this.prisma.appointment.findMany({
          where: whereClause,
          include: {
            client: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true
              }
            },
            tatoueur: {
              select: {
                name: true
              }
            },
            tattooDetail: {
              select: {
                description: true,
                zone: true,
                size: true,
                colorStyle: true,
                reference: true,
                sketch: true,
                piercingZone: true,
                piercingServicePriceId: true,
                estimatedPrice: true,
                price: true,
                piercingServicePrice: {
                  select: {
                    description: true,
                    piercingZoneOreille: true,
                    piercingZoneVisage: true,
                    piercingZoneBouche: true,
                    piercingZoneCorps: true,
                    piercingZoneMicrodermal: true
                  }
                }
              }
            }
          },
          orderBy: {
            start: "desc"
          },
          skip,
          take: perPage,
        }),
        this.prisma.appointment.findMany({
          where: whereClause,
          include: {
            tattooDetail: {
              select: {
                price: true
              }
            }
          }
        })
      ]);

      // 3. Formater les données pour le front-end
      const factures = appointments.map(appointment => ({
        id: appointment.id,
        client: {
          firstName: appointment.client?.firstName || null,
          lastName: appointment.client?.lastName || null,
          email: appointment.client?.email || null,
          phone: appointment.client?.phone || null
        },
        prestation: appointment.prestation,
        title: appointment.title,
        price: appointment.tattooDetail?.price || 0,
        estimatedPrice: appointment.tattooDetail?.estimatedPrice || 0,
        isPayed: appointment.isPayed,
        dateRdv: appointment.start,
        duration: appointment.end && appointment.start 
          ? Math.round((appointment.end.getTime() - appointment.start.getTime()) / (1000 * 60))
          : 0,
        prestationDetails: {
          description: appointment.tattooDetail?.description || null,
          zone: appointment.tattooDetail?.zone || null,
          size: appointment.tattooDetail?.size || null,
          colorStyle: appointment.tattooDetail?.colorStyle || null,
          reference: appointment.tattooDetail?.reference || null,
          sketch: appointment.tattooDetail?.sketch || null,
          piercingZone: appointment.tattooDetail?.piercingZone || null,
          piercingDetails: appointment.tattooDetail?.piercingServicePrice ? {
            serviceDescription: appointment.tattooDetail.piercingServicePrice.description || null,
            zoneOreille: appointment.tattooDetail.piercingServicePrice.piercingZoneOreille || null,
            zoneVisage: appointment.tattooDetail.piercingServicePrice.piercingZoneVisage || null,
            zoneBouche: appointment.tattooDetail.piercingServicePrice.piercingZoneBouche || null,
            zoneCorps: appointment.tattooDetail.piercingServicePrice.piercingZoneCorps || null,
            zoneMicrodermal: appointment.tattooDetail.piercingServicePrice.piercingZoneMicrodermal || null
          } : null
        },
        tatoueur: appointment.tatoueur?.name || null
      }));

      // 4. Calculer les statistiques sur TOUTES les factures
      const totalChiffreAffaires = allAppointmentsForStats.reduce((sum, appointment) => sum + (appointment.tattooDetail?.price || 0), 0);
      const totalPaye = allAppointmentsForStats
        .filter(appointment => appointment.isPayed)
        .reduce((sum, appointment) => sum + (appointment.tattooDetail?.price || 0), 0);
      const totalEnAttente = allAppointmentsForStats
        .filter(appointment => !appointment.isPayed)
        .reduce((sum, appointment) => sum + (appointment.tattooDetail?.price || 0), 0);
      const nombreFacturesPaye = allAppointmentsForStats.filter(appointment => appointment.isPayed).length;
      const nombreFacturesEnAttente = allAppointmentsForStats.filter(appointment => !appointment.isPayed).length;

      // 5. Calculer les informations de pagination
      const totalPages = Math.ceil(totalFactures / perPage);
      const startIndex = totalFactures === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + perPage, totalFactures);

      const result = {
        error: false,
        factures,
        pagination: {
          currentPage,
          limit: perPage,
          totalFactures,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
          startIndex,
          endIndex,
        },
        statistics: {
          totalFactures,
          totalChiffreAffaires,
          totalPaye,
          totalEnAttente,
          nombreFacturesPaye,
          nombreFacturesEnAttente,
          tauxPaiement: totalFactures > 0 ? Math.round((nombreFacturesPaye / totalFactures) * 100) : 0
        },
        message: `${factures.length} facture(s) sur ${totalFactures} récupérée(s) avec succès.`
      };

      // 6. Mettre en cache
      try {
        const ttl = 30 * 60; // 30 minutes
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getFactureSalon:', cacheError);
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

  //! METTRE À JOUR LES COULEURS DU PROFIL

  //! ------------------------------------------------------------------------------
  async updateColorProfile({userId, colorProfile, colorProfileBis}: {userId: string, colorProfile?: string, colorProfileBis?: string}) {
    try {
      // Préparer les données à mettre à jour (seulement les champs fournis)
      const updateData: { colorProfile?: string; colorProfileBis?: string } = {};
      
      if (colorProfile !== undefined) {
        updateData.colorProfile = colorProfile;
      }
      
      if (colorProfileBis !== undefined) {
        updateData.colorProfileBis = colorProfileBis;
      }

      // Vérifier qu'au moins un champ est fourni
      if (Object.keys(updateData).length === 0) {
        return {
          error: true,
          message: 'Aucune couleur de profil fournie pour la mise à jour.',
        };
      }

      const user = await this.prisma.user.update({
        where: {
          id: userId,
        },
        data: updateData,
        select: {
          id: true,
          colorProfile: true,
          colorProfileBis: true,
          salonName: true,
        },
      });

      // Invalider le cache après update
      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.del(`user:color-profile:${userId}`);
      // Invalider les caches de listes et de slug car les couleurs peuvent affecter l'affichage
      this.cacheService.delPattern('users:list:*');
      this.cacheService.delPattern('user:slug:*');

      return {
        error: false,
        message: 'Couleurs du profil mises à jour avec succès.',
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
  //! MÉTHODES POUR LES CLIENTS CONNECTÉS
  //! ------------------------------------------------------------------------------

  //! RECUPERER LES SALONS FAVORIS D'UN CLIENT
  async getFavoriteSalons({userId}: {userId: string}): Promise<Record<string, any>> {
    try {
      const favorites = await this.prisma.favoriteUser.findMany({
        where: { clientId: userId },
        select: {
          salon: {
            select: {
              id: true,
              salonName: true,
              city: true,
              postalCode: true,
              image: true,
              description: true,
              instagram: true,
              facebook: true,
              tiktok: true,
              website: true,
            }
          }
        }
      });
      const favoriteSalons = favorites.map(fav => fav.salon);
      return {
        error: false,
        favoriteSalons,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! RECUPERER TOUS LES RDV D'UN CLIENT
  async getAllRdvForClient({userId, status, page = 1, limit = 10}: {userId: string, status?: string, page?: number, limit?: number}): Promise<Record<string, any>> {
    try {
      const currentPage = Math.max(1, Number(page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
      const skip = (currentPage - 1) * perPage;

      // Créer une clé de cache basée sur les paramètres
      const cacheKey = `client:appointments:${userId}:${JSON.stringify({
        status: status?.trim() || null,
        page: currentPage,
        limit: perPage
      })}`;

      // 1. Vérifier dans Redis
      try {
        const cachedAppointments = await this.cacheService.get<{
          error: boolean;
          appointments: Record<string, any>[];
          pagination: Record<string, any>;
          message: string;
        }>(cacheKey);
        if (cachedAppointments) {
          return cachedAppointments;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getAllRdvForClient:', cacheError);
      }

      // Construire les conditions de recherche
      const whereClause: Record<string, any> = {
        clientUserId: userId, // RDV pris en tant que client connecté
      };

      // Filtrer par statut si spécifié
      if (status && status.trim() !== '') {
        whereClause.status = status.toUpperCase();
      }

      // 2. Compter le total et récupérer les données avec pagination
      const [totalAppointments, appointments] = await this.prisma.$transaction([
        this.prisma.appointment.count({ where: whereClause }),
        this.prisma.appointment.findMany({
          where: whereClause,
          select: {
            id: true,
            title: true,
            prestation: true,
            start: true,
            end: true,
            status: true,
            isPayed: true,
            createdAt: true,
            updatedAt: true,
            visio: true,
            visioRoom: true,
            // Informations du salon
            user: {
              select: {
                id: true,
                salonName: true,
                firstName: true,
                lastName: true,
                image: true,
                city: true,
                postalCode: true,
                phone: true,
                address: true,
                instagram: true,
                website: true
              }
            },
            // Informations du tatoueur
            tatoueur: {
              select: {
                id: true,
                name: true,
                img: true,
                phone: true,
                instagram: true
              }
            },
            // Détails du tatouage/piercing
            tattooDetail: {
              select: {
                id: true,
                description: true,
                zone: true,
                size: true,
                colorStyle: true,
                reference: true,
                sketch: true,
                piercingZone: true,
                estimatedPrice: true,
                price: true,
                piercingServicePrice: {
                  select: {
                    description: true,
                    piercingZoneOreille: true,
                    piercingZoneVisage: true,
                    piercingZoneBouche: true,
                    piercingZoneCorps: true,
                    piercingZoneMicrodermal: true
                  }
                }
              }
            },
            // Avis laissé par le client pour ce RDV
            salonReview: {
              select: {
                id: true,
                rating: true,
                title: true,
                comment: true,
                photos: true,
                isVerified: true,
                isVisible: true,
                createdAt: true,
                salonResponse: true,
                salonRespondedAt: true
              }
            }
          },
          orderBy: {
            start: 'desc' // Plus récents en premier
          },
          skip,
          take: perPage,
        })
      ]);

      // 3. Formater les données pour le front-end
      const formattedAppointments = appointments.map(appointment => ({
        id: appointment.id,
        title: appointment.title,
        prestation: appointment.prestation,
        start: appointment.start,
        end: appointment.end,
        status: appointment.status,
        isPayed: appointment.isPayed,
        visio: appointment.visio,
        visioRoom: appointment.visioRoom,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
        duration: appointment.end && appointment.start 
          ? Math.round((appointment.end.getTime() - appointment.start.getTime()) / (1000 * 60))
          : 0,
        salon: {
          id: appointment.user.id,
          salonName: appointment.user.salonName,
          firstName: appointment.user.firstName,
          lastName: appointment.user.lastName,
          image: appointment.user.image,
          city: appointment.user.city,
          postalCode: appointment.user.postalCode,
          phone: appointment.user.phone,
          address: appointment.user.address,
          instagram: appointment.user.instagram,
          website: appointment.user.website
        },
        tatoueur: appointment.tatoueur ? {
          id: appointment.tatoueur.id,
          name: appointment.tatoueur.name,
          img: appointment.tatoueur.img,
          phone: appointment.tatoueur.phone,
          instagram: appointment.tatoueur.instagram
        } : null,
        prestationDetails: appointment.tattooDetail ? {
          id: appointment.tattooDetail.id,
          description: appointment.tattooDetail.description,
          zone: appointment.tattooDetail.zone,
          size: appointment.tattooDetail.size,
          colorStyle: appointment.tattooDetail.colorStyle,
          reference: appointment.tattooDetail.reference,
          sketch: appointment.tattooDetail.sketch,
          piercingZone: appointment.tattooDetail.piercingZone,
          estimatedPrice: appointment.tattooDetail.estimatedPrice,
          price: appointment.tattooDetail.price,
          piercingDetails: appointment.tattooDetail.piercingServicePrice ? {
            description: appointment.tattooDetail.piercingServicePrice.description,
            zoneOreille: appointment.tattooDetail.piercingServicePrice.piercingZoneOreille,
            zoneVisage: appointment.tattooDetail.piercingServicePrice.piercingZoneVisage,
            zoneBouche: appointment.tattooDetail.piercingServicePrice.piercingZoneBouche,
            zoneCorps: appointment.tattooDetail.piercingServicePrice.piercingZoneCorps,
            zoneMicrodermal: appointment.tattooDetail.piercingServicePrice.piercingZoneMicrodermal
          } : null
        } : null,
        review: appointment.salonReview ? {
          id: appointment.salonReview.id,
          rating: appointment.salonReview.rating,
          title: appointment.salonReview.title,
          comment: appointment.salonReview.comment,
          photos: appointment.salonReview.photos,
          isVerified: appointment.salonReview.isVerified,
          isVisible: appointment.salonReview.isVisible,
          createdAt: appointment.salonReview.createdAt,
          salonResponse: appointment.salonReview.salonResponse,
          salonRespondedAt: appointment.salonReview.salonRespondedAt
        } : null
      }));

      // 4. Calculer les informations de pagination
      const totalPages = Math.ceil(totalAppointments / perPage);
      const startIndex = totalAppointments === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + perPage, totalAppointments);

      const result = {
        error: false,
        appointments: formattedAppointments,
        pagination: {
          currentPage,
          limit: perPage,
          totalAppointments,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
          startIndex,
          endIndex,
        },
        message: `${formattedAppointments.length} rendez-vous sur ${totalAppointments} récupéré(s) avec succès.`
      };

      // 5. Mettre en cache (TTL 10 minutes - les RDV clients changent moins souvent)
      try {
        const ttl = 10 * 60; // 10 minutes
        await this.cacheService.set(cacheKey, result, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getAllRdvForClient:', cacheError);
      }

      return result;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la récupération des rendez-vous: ${errorMessage}`,
      };
    }
  }

  //! METTRE EN FAVORI / RETIRER DES FAVORIS UN SALON
  async toggleFavoriteSalon({userId, salonId}: {userId: string, salonId: string}): Promise<Record<string, any>> {
    try {
      // Vérifier si le salon est déjà dans les favoris
      const existingFavorite = await this.prisma.favoriteUser.findUnique({
        where: {
          clientId_salonId: {
            clientId: userId,
            salonId: salonId
          }
        }
      });
      if (existingFavorite) {
        // Retirer des favoris
        await this.prisma.favoriteUser.delete({
          where: {
            clientId_salonId: {
              clientId: userId,
              salonId: salonId
            }
          }
        });
        return {
          error: false,
          message: 'Salon retiré des favoris avec succès.'
        };
      } else {
        // Ajouter aux favoris
        await this.prisma.favoriteUser.create({
          data: {
            clientId: userId,
            salonId: salonId
          }
        });
        return {
          error: false,
          message: 'Salon ajouté aux favoris avec succès.'
        };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la mise à jour des favoris: ${errorMessage}`,
      };
    }
  }
      
}