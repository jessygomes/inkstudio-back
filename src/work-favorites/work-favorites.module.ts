import { Global, Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { WorkFavoritesController } from './work-favorites.controller';
import { WorkFavoritesService } from './work-favorites.service';

/** Global : UserService l'utilise pour prévenir le professionnel d'un favori sur une réalisation. */
@Global()
@Module({
  controllers: [WorkFavoritesController],
  providers: [WorkFavoritesService, PrismaService],
  exports: [WorkFavoritesService],
})
export class WorkFavoritesModule {}
