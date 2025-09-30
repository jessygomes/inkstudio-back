import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaModule } from 'src/database/prisma.module';
import { CacheService } from 'src/redis/cache.service';

@Module({
  imports: [PrismaModule], //! Importer le module PrismaModule dans le module UserModule pour pouvoir utiliser le service PrismaService dans le service UserService
  controllers: [UserController],
  providers: [UserService, CacheService],
})
export class UserModule {}
