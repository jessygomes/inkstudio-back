/* eslint-disable prettier/prettier */
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

  //! UPDATE USER
  async updateUser({userId, userBody} : {userId: string; userBody: { salonName: string; firstName: string; lastName: string; phone: string; address: string; city: string; postalCode: string; instagram: string; facebook: string; tiktok: string; website: string; description: string; }}) {
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
}
