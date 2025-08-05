import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
// import { User, Prisma } from '@prisma/client';

@Injectable()
export class UserService {
  // Injecter le service Prisma dans le service User
  constructor(private prisma: PrismaService) {}

  //! GET ALL USERS
  async getUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        salonName: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        postalCode: true,
        salonHours: true,
        role: true,
      },
    }) as { id: string; email: string; salonName: string; role: string }[];
    return users;
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
        Tatoueur: {
          select: {
            id: true,
            name: true,
            img: true,
            description: true,
            phone: true,
            hours: true,
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
  async updateUser({userId, userBody} : {userId: string; userBody: { salonName: string; firstName: string; lastName: string; phone: string; address: string; city: string; postalCode: string; instagram: string; facebook: string; tiktok: string; website: string; description: string; image: string; }}) {
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
      },
    }) 

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
