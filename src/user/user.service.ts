import { AgendaMode } from '@prisma/client';
import {Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CachedUser, LinkedSalon, LinkedTatoueurUser, SlugUser } from 'utils/type';
// import { User, Prisma } from '@prisma/client';

type SlugUserCandidate = Pick<SlugUser, 'id' | 'role' | 'salonName' | 'city' | 'postalCode'>;

@Injectable()
export class UserService {
  // Injecter le service Prisma dans le service User
  constructor(private prisma: PrismaService, 
    private cacheService: CacheService) {}

  private normalizeStyles(styleInput: unknown): string[] {
    return Array.isArray(styleInput)
      ? [
          ...new Set(
            styleInput
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean),
          ),
        ]
      : [];
  }

  private buildAppointmentBookingSettings({
    role,
    agendaMode,
  }: {
    role?: string | null;
    agendaMode?: AgendaMode | null;
  }) {
    const effectiveAgendaMode =
      role === 'user_salon'
        ? AgendaMode.PAR_TATOUEUR
        : role === 'user_tatoueur'
          ? AgendaMode.GLOBAL
          : (agendaMode ?? AgendaMode.GLOBAL);

    return {
      agendaMode: effectiveAgendaMode,
    };
  }

  //! -------------------------------------------------
  //! GET USERS 
  //! -------------------------------------------------
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

      const normalizedStyleFilter =
        typeof style === 'string' && style.trim() !== ''
          ? style.trim().toUpperCase()
          : '';

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
      if (normalizedStyleFilter) {
        where.Tatoueur = {
          some: {
            style: { has: normalizedStyleFilter }
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
            profileImage: true,
            firstName: true,
            lastName: true,
            phone: true,
            address: true,
            city: true,
            postalCode: true,
            salonHours: true,
            prestations: true,
            style: true,
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
            isInspirationSalon: true,
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

  //! -------------------------------------------------
  //! SEARCH USERS (pour la barre de recherche du front)
  //! -------------------------------------------------
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
        profileImage: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        postalCode: true,
        salonHours: true,
        prestations: true,
        style: true,
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

  //! -------------------------------------------------
  //! RECUPERER LES VILLES
  //! -------------------------------------------------
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

  //! -------------------------------------------------
  //! RECUPERER LES STYLES
  //! -------------------------------------------------
  async getDistinctStyles(): Promise<string[]> {
    const [tatoueurRows, userRows] = await Promise.all([
      this.prisma.tatoueur.findMany({
        select: { style: true },
      }),
      this.prisma.user.findMany({
        where: {
          role: { in: ['user', 'user_salon', 'user_tatoueur'] },
        },
        select: { style: true },
      }),
    ]);

    const typedTatoueurRows = tatoueurRows as unknown as Array<{ style: string[] | null }>;
    const typedUserRows = userRows as unknown as Array<{ style: string[] | null }>;

    const tattooerStyles: string[] = typedTatoueurRows.flatMap((r) =>
      Array.isArray(r.style)
        ? r.style.filter((value): value is string => typeof value === 'string')
        : [],
    );
    const userStyles: string[] = typedUserRows.flatMap((r) =>
      Array.isArray(r.style)
        ? r.style.filter((value): value is string => typeof value === 'string')
        : [],
    );
    const allStyles = [...tattooerStyles, ...userStyles];

    return Array.from(new Set(allStyles.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort();
  }

  /**
   *! Normalise une chaine pour produire un slug stable.
   * Utilisé pour comparer les segments d'URL salon/localisation sans dépendre
   * des accents, de la casse ou des caractères spéciaux.
   */
  private toSlug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  /**
   *! Construit le slug de localisation à partir de la ville et du code postal.
   */
  private buildLocationSlug(city?: string | null, postalCode?: string | null): string {
    const locSource = [city, postalCode]
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .join('-');

    return this.toSlug(locSource) || 'localisation';
  }

  /**
   *! Récupère uniquement les champs strictement nécessaires pour trouver l'utilisateur
   * correspondant aux slugs de l'URL.
   *
   * Optimisation importante:
   * on ne charge plus ici les tatoueurs, produits, photos et autres données lourdes
   * pour tous les salons. On cherche d'abord le bon ID, puis on ne charge le profil
   * complet que pour ce match précis.
   */
  private async getSlugUserCandidates(): Promise<SlugUserCandidate[]> {
    return this.prisma.user.findMany({
      where: {
        salonName: { not: null },
        city: { not: null },
        postalCode: { not: null },
      },
      select: {
        id: true,
        role: true,
        salonName: true,
        city: true,
        postalCode: true,
      },
    });
  }

  /**
   *! Une fois l'ID trouvé par slug, charge le profil complet utilisé par le front.
   *
   * Cette seconde étape remplace l'ancien comportement qui chargeait ce gros payload
   * pour tous les utilisateurs avant même de savoir lequel correspondait.
   */
  private async getSlugUserProfileById(userId: string): Promise<SlugUser | null> {
    const userResult = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        verifiedSalon: true,
        salonName: true,
        description: true,
        image: true,
        profileImage: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        postalCode: true,
        salonHours: true,
        prestations: true,
        style: true,
        appointmentBookingEnabled: true,
        addConfirmationEnabled: true,
        colorProfile: true,
        colorProfileBis: true,
        saasPlan: true,
        saasPlanDetails: {
          select: {
            currentPlan: true,
            agendaMode: true,
          },
        },
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
            rdvBookingEnabled: true,
          },
        },
        salonPhotos: true,
        instagram: true,
        facebook: true,
        tiktok: true,
        website: true,
        ProductSalon: {
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return userResult as unknown as SlugUser | null;
  }

  /**
   *! Trouve le profil correspondant au couple de slugs {nom, localisation}.
   */
  private findUserBySlugs(users: SlugUserCandidate[], nameSlug: string, locSlug: string): SlugUserCandidate | undefined {
    return users.find((user) => {
      const salonSlug = this.toSlug(user.salonName || '');
      const locationSlug = this.buildLocationSlug(user.city, user.postalCode);
      return salonSlug === nameSlug && locationSlug === locSlug;
    });
  }

  /**
   *! Uniformise la structure des salons liés renvoyée au front.
   */
  private buildLinkedSalon(
    salon: {
      id: string;
      salonName: string | null;
      profileImage: string | null;
      address: string | null;
      city: string | null;
      postalCode: string | null;
      instagram: string | null;
      website: string | null;
      salonHours: string | null;
      prestations: string[];
      image: string | null;
    },
    isCurrentSalon: boolean,
    linkedAt: Date | null,
  ): LinkedSalon {
    return {
      id: salon.id,
      salonName: salon.salonName,
      profileImage: salon.profileImage,
      address: salon.address,
      city: salon.city,
      postalCode: salon.postalCode,
      instagram: salon.instagram,
      website: salon.website,
      salonHours: salon.salonHours,
      prestations: salon.prestations,
      image: salon.image,
      isCurrentSalon,
      linkedAt,
    };
  }

  /**
   *! Enrichit un profil user_tatoueur avec les salons liés historiques + salon courant.
   */
  private async enrichTatoueurSlugUser(found: SlugUser): Promise<Record<string, any>> {
    // Pour un profil tatoueur lié, on ne renvoie pas une liste de tatoueurs,
    // mais la liste des salons auxquels ce tatoueur est ou a été rattaché.
    const tatoueurUser = await this.prisma.user.findUnique({
      where: { id: found.id },
      select: {
        salonId: true,
        salon: {
          select: {
            id: true,
            salonName: true,
            profileImage: true,
            address: true,
            city: true,
            postalCode: true,
            instagram: true,
            website: true,
            salonHours: true,
            prestations: true,
            image: true,
          },
        },
      },
    });

    const acceptedRequests = await this.prisma.salonTatoueurTeamRequest.findMany({
      where: {
        tatoueurUserId: found.id,
        status: 'ACCEPTED',
      },
      orderBy: { respondedAt: 'desc' },
      select: {
        respondedAt: true,
        createdAt: true,
        salon: {
          select: {
            id: true,
            salonName: true,
            profileImage: true,
            address: true,
            city: true,
            postalCode: true,
            instagram: true,
            website: true,
            salonHours: true,
            prestations: true,
            image: true,
          },
        },
      },
    });

    const salonsMap = new Map<string, LinkedSalon>();

  // On déduplique les salons car plusieurs demandes ACCEPTED peuvent pointer
  // vers le même salon au fil du temps.
    for (const item of acceptedRequests) {
      const salon = item.salon;
      if (!salonsMap.has(salon.id)) {
        salonsMap.set(
          salon.id,
          this.buildLinkedSalon(
            salon,
            tatoueurUser?.salonId === salon.id,
            item.respondedAt ?? item.createdAt,
          ),
        );
      }
    }

    if (tatoueurUser?.salon && !salonsMap.has(tatoueurUser.salon.id)) {
      salonsMap.set(
        tatoueurUser.salon.id,
        this.buildLinkedSalon(tatoueurUser.salon, true, null),
      );
    }

    const linkedSalons = Array.from(salonsMap.values()).sort((a, b) => {
      // Le salon courant reste toujours en premier, puis les autres par date
      // de rattachement décroissante.
      if (a.isCurrentSalon && !b.isCurrentSalon) return -1;
      if (!a.isCurrentSalon && b.isCurrentSalon) return 1;
      const aTs = a.linkedAt ? a.linkedAt.getTime() : 0;
      const bTs = b.linkedAt ? b.linkedAt.getTime() : 0;
      return bTs - aTs;
    });

    return {
      ...found,
      Tatoueur: [],
      linkedSalons,
    };
  }

  /**
   *! Transforme un user_tatoueur lié en forme compatible avec la liste Tatoueur du front.
   */
  private mapLinkedTatoueurUser(user: LinkedTatoueurUser) {
    const displayName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Tatoueur';

    return {
      id: `linked_${user.id}`,
      name: displayName,
      salonName: user.salonName,
      city: user.city,
      postalCode: user.postalCode,
      img: user.profileImage ?? user.image,
      description: user.description,
      phone: user.phone,
      hours: null,
      instagram: user.instagram,
      tiktok: user.tiktok,
      website: user.website,
      style: user.style,
      skills: user.prestations,
      rdvBookingEnabled: user.appointmentBookingEnabled,
      isLinkedUser: true,
      linkedUserId: user.id,
      profileUserId: user.id,
    };
  }

  /**
   *! Enrichit un salon avec les tatoueurs internes + les tatoueurs liés via user_tatoueur.
   */
  private async enrichSalonSlugUser(found: SlugUser): Promise<Record<string, any>> {
    // Ici on complète le salon avec les tatoueurs "liés" (profils user_tatoueur)
    // en plus des tatoueurs internes déjà présents dans found.Tatoueur.
    const linkedTatoueurUsersResult = await this.prisma.user.findMany({
      where: {
        salonId: found.id,
        role: 'user_tatoueur',
      },
      select: {
        id: true,
        salonName: true,
        city: true,
        postalCode: true,
        firstName: true,
        lastName: true,
        image: true,
        profileImage: true,
        phone: true,
        instagram: true,
        tiktok: true,
        website: true,
        description: true,
        style: true,
        prestations: true,
        appointmentBookingEnabled: true,
      },
    });

    const linkedTatoueurUsers = linkedTatoueurUsersResult as unknown as LinkedTatoueurUser[];
    const linkedTatoueurs = linkedTatoueurUsers.map((user) => this.mapLinkedTatoueurUser(user));

    // Les tatoueurs internes n'ont pas les mêmes champs que les profils liés.
    // On homogénéise la structure pour que le front consomme une liste unique.
    const internalTatoueurs = (found.Tatoueur ?? []).map((tatoueur) => ({
      ...tatoueur,
      salonName: null,
      city: null,
      postalCode: null,
      tiktok: null,
      website: null,
      isLinkedUser: false,
      profileUserId: null,
    }));

    return {
      ...found,
      Tatoueur: [...internalTatoueurs, ...linkedTatoueurs],
      linkedSalons: [],
    };
  }

  /**
   * Route l'enrichissement selon le type de profil retourné par le matching de slug.
   */
  private async enrichSlugUser(found: SlugUser): Promise<Record<string, any>> {
    if (found.role === 'user_tatoueur') {
      return this.enrichTatoueurSlugUser(found);
    }

    return this.enrichSalonSlugUser(found);
  }

  //! -------------------------------------------------
  //! GET USER BY SLUG + LOCALISATION
  //! -------------------------------------------------
  async getUserBySlugAndLocation({ nameSlug, locSlug }: { nameSlug: string; locSlug: string }): Promise<Record<string, any> | null> {
    try {
      const cacheKey = `user:slug:${nameSlug}:${locSlug}`;

      // Vue d'ensemble de cette méthode:
      // 1) lire le cache
      // 2) trouver rapidement l'ID du bon profil via un jeu minimal de candidats
      // 3) charger le profil complet correspondant
      // 4) enrichir selon le rôle (salon ou user_tatoueur)
      // 5) stocker le résultat final en cache
      try {
        const cachedUser = await this.cacheService.get(cacheKey);
        if (cachedUser) {
          return cachedUser;
        }
      } catch (cacheError) {
        console.warn('Erreur cache Redis pour getUserBySlugAndLocation:', cacheError);
      }

      // 2. On ne charge que des candidats légers pour faire le matching par slug.
      const candidates = await this.getSlugUserCandidates();
      const foundCandidate = this.findUserBySlugs(candidates, nameSlug, locSlug);

      // Aucun match => on mettra null en cache pour éviter de refaire la recherche.
      if (!foundCandidate) {
        try {
          const ttl = 2 * 60 * 60;
          await this.cacheService.set(cacheKey, null, ttl);
        } catch (cacheError) {
          console.warn('Erreur sauvegarde cache Redis pour getUserBySlugAndLocation:', cacheError);
        }

        return null;
      }

      // 3. Maintenant seulement, on charge le vrai profil complet correspondant.
      const found = await this.getSlugUserProfileById(foundCandidate.id);

      if (!found) {
        return null;
      }

      // 4. On enrichit ensuite la forme finale selon le rôle.
      // - user_tatoueur: on remonte les salons liés
      // - salon: on fusionne tatoueurs internes et profils liés
      const enrichedFound = await this.enrichSlugUser(found);

      // 5. Le résultat enrichi est mis en cache pour les prochains accès.
      try {
        const ttl = 2 * 60 * 60;
        await this.cacheService.set(cacheKey, enrichedFound, ttl);
      } catch (cacheError) {
        console.warn('Erreur sauvegarde cache Redis pour getUserBySlugAndLocation:', cacheError);
      }

      return enrichedFound;
    } catch (error) {
      console.error('Erreur dans getUserBySlugAndLocation:', error);
      throw error;
    }
  }

  //! -------------------------------------------------
  //! GET USER BY ID
  //! -------------------------------------------------
  async getUserById({userId} : {userId: string}): Promise<CachedUser | null> {
    const cacheKey = `user:${userId}`;

    // Toujours invalider avant lecture pour forcer un profil à jour.
    await this.cacheService.del(cacheKey);

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
          profileImage: true,
          role: true,
          verifiedSalon: true,
          prestations: true,
          style: true,
          isInspirationSalon: true,
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

  //! -------------------------------------------------
  //! GET USER PARAM BY ID
  //! -------------------------------------------------
  async getUserParamById({userId} : {userId: string}): Promise<CachedUser | null> {
    const cacheKey = `user:param:${userId}`;

    // Toujours invalider avant lecture pour forcer un profil à jour.
    await this.cacheService.del(cacheKey);

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
          role: true,
          verifiedSalon: true,
          isInspirationSalon: true,
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

  //! -------------------------------------------------
  //! GET PHOTOS SALON
  //! -------------------------------------------------
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

  //! -------------------------------------------------
  //! UPDATE USER
  //! -------------------------------------------------
  async updateUser({userId, userBody} : {userId: string; userBody: { salonName: string; firstName: string; lastName: string; phone: string; address: string; city: string; postalCode: string; instagram: string; facebook: string; tiktok: string; website: string; description: string; image: string; profileImage?: string; prestations?: string[]; style?: string[] | string | null; }}): Promise<Record<string, any>> {
    
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

    const rawStyles = Array.isArray(userBody.style)
      ? userBody.style
      : (typeof userBody.style === 'string' && userBody.style.trim() !== '')
        ? userBody.style.split(',')
        : [];

    const safeStyles = [...new Set(
      rawStyles
        .filter((item): item is string => typeof item === 'string'),
    )];

    const normalizedStyles = this.normalizeStyles(safeStyles);

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
        profileImage: userBody.profileImage,
        prestations: safePrestations,
        style: normalizedStyles
      },
    });

    // Invalider le cache après update
    await this.cacheService.del(`user:${userId}`);
    // Invalider aussi tous les caches de listes d'utilisateurs
    await this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug qui pourraient être affectés
    await this.cacheService.delPattern('user:slug:*');
    // Invalider les caches de RDV client qui exposent l'image du salon
    await this.cacheService.delPattern('client:appointments:*');

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
    await this.cacheService.delPattern('users:list:*');
    await this.cacheService.delPattern('user:slug:*');
    await this.cacheService.delPattern('client:appointments:*');

    return user;
  }

  

  //! -------------------------------------------------
  //! UPDATE HOURS SALON
  //! -------------------------------------------------
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
    await this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug car les horaires peuvent affecter l'affichage
    await this.cacheService.delPattern('user:slug:*');

    return user;
  }

  //! -------------------------------------------------
  //! ADD OR UPDATE PHOTO SALON
  //! -------------------------------------------------
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
    await this.cacheService.delPattern('users:list:*');
    // Invalider les caches de slug car les photos peuvent affecter l'affichage
    await this.cacheService.delPattern('user:slug:*');
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

      console.log(`Updated confirmation setting for user ${userId}: ${addConfirmationEnabled}`);

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

  //! AGENDA GLOBAL OU AGENDA TATOUEUR

  //! ------------------------------------------------------------------------------
  async getAppointmentBooking({userId}: {userId: string}) {
    try {
      const cacheKey = `user:appointment-booking:${userId}`;

      // 1. Vérifier dans Redis
      const cachedSetting = await this.cacheService.get<{
        agendaMode: AgendaMode;
      }>(cacheKey);
      
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
          role: true,
          saasPlanDetails: {
            select: {
              agendaMode: true,
            },
          },
        },
      });

      const setting = user
        ? this.buildAppointmentBookingSettings({
            role: user.role,
            agendaMode: user.saasPlanDetails?.agendaMode,
          })
        : null;

      // 3. Mettre en cache (TTL 1 heure pour les settings)
      if (setting) {
        await this.cacheService.set(cacheKey, setting, 3600);
      }

      return {
        error: false,
        user: setting,
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

  //! METTRE À JOUR : AGENDA GLOBAL OU AGENDA TATOUEUR

  //! ------------------------------------------------------------------------------
  async updateAppointmentBooking({userId, agendaMode}: {userId: string, agendaMode: AgendaMode}) {
    try {
      const existingUser = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          role: true,
          saasPlanDetails: {
            select: {
              currentPlan: true,
            },
          },
        },
      });

      if (!existingUser) {
        return {
          error: true,
          message: 'Utilisateur introuvable',
        };
      }

      const nextSettings = this.buildAppointmentBookingSettings({
        role: existingUser.role,
        agendaMode,
      });

      await this.prisma.saasPlanDetails.upsert({
        where: { userId },
        update: {
          agendaMode: nextSettings.agendaMode,
        },
        create: {
          userId,
          ...(existingUser.saasPlanDetails?.currentPlan
            ? { currentPlan: existingUser.saasPlanDetails.currentPlan }
            : {}),
          agendaMode: nextSettings.agendaMode,
        },
      });

      // Invalider le cache après update
      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.del(`user:appointment-booking:${userId}`);

      return {
        error: false,
        message: nextSettings.agendaMode === AgendaMode.PAR_TATOUEUR
          ? 'Agenda par tatoueur activé avec succès.'
          : 'Agenda global activé avec succès.',
        user: {
          agendaMode: nextSettings.agendaMode,
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
      await this.cacheService.delPattern('users:list:*');
      await this.cacheService.delPattern('user:slug:*');

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

  //! -------------------------------------------------
  //! BASCULER LE STATUT D'INSPIRATION DU SALON
  //! -------------------------------------------------
  async toggleInspirationSalon({ userId, role }: { userId: string; role?: string }) {
    try {
      if (role !== 'user_salon') {
        return {
          error: true,
          message: 'Accès réservé aux salons.',
        };
      }

      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          isInspirationSalon: true,
          salonName: true,
        },
      });

      if (!existingUser) {
        return {
          error: true,
          message: 'Utilisateur introuvable.',
        };
      }

      if (existingUser.role !== 'user_salon') {
        return {
          error: true,
          message: 'Accès réservé aux salons.',
        };
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          isInspirationSalon: !existingUser.isInspirationSalon,
        },
        select: {
          id: true,
          salonName: true,
          isInspirationSalon: true,
          role: true,
        },
      });

      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.delPattern('users:list:*');
      await this.cacheService.delPattern('user:slug:*');
      await this.cacheService.delPattern('portfolio:inspirations:*');

      return {
        error: false,
        message: updatedUser.isInspirationSalon
          ? 'Vos images sont maintenant affichées dans les inspirations.'
          : 'Vos images sont retirées des inspirations.',
        user: updatedUser,
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

  //! RECUPERER LES IMAGES DE PORTFOLIO FAVORITES D'UN CLIENT
  async getFavoritePortfolioImages({ userId }: { userId: string }): Promise<Record<string, any>> {
    try {
      const favorites = await this.prisma.favoritePortfolio.findMany({
        where: { clientId: userId },
        select: {
          createdAt: true,
          portfolio: {
            select: {
              id: true,
              title: true,
              description: true,
              imageUrl: true,
              style: true,
              createdAt: true,
              updatedAt: true,
              user: {
                select: {
                  id: true,
                  salonName: true,
                  image: true,
                  city: true,
                  postalCode: true,
                  instagram: true,
                },
              },
              tatoueur: {
                select: {
                  id: true,
                  name: true,
                  img: true,
                  instagram: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        error: false,
        favoritePortfolioImages: favorites.map((favorite) => ({
          ...favorite.portfolio,
          favoritedAt: favorite.createdAt,
        })),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! METTRE EN FAVORI / RETIRER DES FAVORIS UNE IMAGE DE PORTFOLIO
  async toggleFavoritePortfolio({
    userId,
    portfolioId,
    role,
  }: {
    userId: string;
    portfolioId: string;
    role?: string;
  }): Promise<Record<string, any>> {
    try {
      if (role && role !== 'client') {
        return {
          error: true,
          message: 'Accès réservé aux clients.',
        };
      }

      const portfolio = await this.prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { id: true, title: true },
      });

      if (!portfolio) {
        return {
          error: true,
          message: 'Image de portfolio introuvable.',
        };
      }

      const existingFavorite = await this.prisma.favoritePortfolio.findUnique({
        where: {
          clientId_portfolioId: {
            clientId: userId,
            portfolioId,
          },
        },
      });

      if (existingFavorite) {
        await this.prisma.favoritePortfolio.delete({
          where: {
            clientId_portfolioId: {
              clientId: userId,
              portfolioId,
            },
          },
        });

        return {
          error: false,
          message: 'Image retirée des favoris avec succès.',
        };
      }

      await this.prisma.favoritePortfolio.create({
        data: {
          clientId: userId,
          portfolioId,
        },
      });

      return {
        error: false,
        message: 'Image ajoutée aux favoris avec succès.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la mise à jour des favoris: ${errorMessage}`,
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

  //! COMPTER LE NOMBRE DE CLIENTS (userClient) QUI ONT MIS EN FAVORI UN SALON
  async getFavoritesCount(salonId: string) {
    try {
      // Vérifier que le salon existe
      const salon = await this.prisma.user.findUnique({
        where: { id: salonId },
        select: { 
          role: true,
          salonName: true 
        }
      });

      if (!salon || (salon.role !== 'user' && salon.role !== 'user_salon' && salon.role !== 'user_tatoueur')) {
        return {
          error: true,
          message: 'Salon introuvable.'
        };
      }

      // Compter le nombre de favoris pour ce salon
      const favoritesCount = await this.prisma.favoriteUser.count({
        where: {
          salonId: salonId
        }
      });

      return {
        error: false,
        salonId,
        salonName: salon.salonName,
        favoritesCount,
        message: `${favoritesCount} client(s) a/ont mis ce salon en favori.`
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la récupération du nombre de favoris: ${errorMessage}`
      };
    }
  }
      
}