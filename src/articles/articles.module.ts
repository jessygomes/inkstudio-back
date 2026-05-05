import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { ArticlesService } from './articles.service';
import { AdminArticlesController } from './admin-articles.controller';
import { PublicArticlesController } from './public-articles.controller';

@Module({
  controllers: [AdminArticlesController, PublicArticlesController],
  providers: [ArticlesService, PrismaService, CacheService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
