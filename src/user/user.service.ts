import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
// import { User, Prisma } from '@prisma/client';

@Injectable()
export class UserService {
  // Injecter le service Prisma dans le service User
  constructor(private prisma: PrismaService) {}

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

      return {
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
    // On récupère tous les salons dont le slug du nom correspond
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
    return found || null;
  }

  //! GET USER BY ID
  async getUserById({userId} : {userId: string}) {
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
    }) 

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
    console.log("Salon photos updated:", limitedPhotos);
    return user;
  }
}
