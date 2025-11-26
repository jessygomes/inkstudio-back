import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // Créer une connexion à la base de données avec Prisma
    await this.$connect();
  }

  async onModuleDestroy() {
    // Quand on arrete l'exécution de notre application, on se déconnecte de Prisma et de la base de données
    await this.$disconnect();
  }
}
