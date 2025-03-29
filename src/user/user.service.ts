/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
// import { User, Prisma } from '@prisma/client';

@Injectable()
export class UserService {
  // Injecter le service Prisma dans le service User
  constructor(private prisma: PrismaService) {}

  async getUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    }) as { id: string; email: string; name: string; role: string }[];
    return users;
  }

  async getUserById({userId} : {userId: string}) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    }) as { id: string; email: string; name: string; role: string };

    return user;
  }
}
