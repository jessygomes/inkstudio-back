import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateFlashDto } from './dto/create-flash.dto';
import { UpdateFlashDto } from './dto/update-flash.dto';

@Injectable()
export class FlashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async createFlash(createFlashDto: CreateFlashDto, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return {
          error: true,
          message: 'Utilisateur non trouve',
        };
      }

      const dimension = (createFlashDto as { dimension?: string }).dimension;

      const flash = await this.prisma.flash.create({
        data: {
          userId,
          title: createFlashDto.title,
          dimension,
          imageUrl: createFlashDto.imageUrl,
          price: createFlashDto.price,
          description: createFlashDto.description,
          isAvailable: createFlashDto.isAvailable ?? true,
        },
      });

      await this.cacheService.del(`flashs:salon:${userId}:available`);

      return {
        error: false,
        message: 'Flash cree avec succes',
        flash,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getAvailableFlashsByUser(userId: string, page: number = 1) {
    try {
      const pageSize = 10;
      const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;
      const skip = (currentPage - 1) * pageSize;
      const cacheKey = `flashs:salon:${userId}:available:page:${currentPage}`;

      const cached = await this.cacheService.get<
        {
          flashs: {
            id: string;
            title: string;
            dimension: string | null;
            imageUrl: string;
            description: string | null;
            price: number;
            isAvailable: boolean;
          }[];
          pagination: {
            page: number;
            pageSize: number;
            total: number;
            totalPages: number;
            hasNextPage: boolean;
            hasPreviousPage: boolean;
          };
        }
      >(cacheKey);

      if (cached) {
        return cached;
      }

      const whereClause = {
        userId,
        isAvailable: true,
      };

      const total = await this.prisma.flash.count({
        where: whereClause,
      });

      const flashs = await this.prisma.flash.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: pageSize,
      });

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const response = {
        flashs,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };

      await this.cacheService.set(cacheKey, response, 1200);

      return response;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async updateFlash(id: string, updateFlashDto: UpdateFlashDto, userId: string) {
    try {
      const existingFlash = await this.prisma.flash.findUnique({
        where: { id },
      });

      if (!existingFlash) {
        return {
          error: true,
          message: 'Flash non trouve',
        };
      }

      if (existingFlash.userId !== userId) {
        return {
          error: true,
          message: 'Non autorise a modifier ce flash',
        };
      }

      const updatedFlash = await this.prisma.flash.update({
        where: { id },
        data: updateFlashDto,
      });

      await this.cacheService.del(`flashs:salon:${existingFlash.userId}:available`);

      return {
        error: false,
        message: 'Flash mis a jour avec succes',
        flash: updatedFlash,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async deleteFlash(id: string, userId: string) {
    try {
      const existingFlash = await this.prisma.flash.findUnique({
        where: { id },
      });

      if (!existingFlash) {
        return {
          error: true,
          message: 'Flash non trouve',
        };
      }

      if (existingFlash.userId !== userId) {
        return {
          error: true,
          message: 'Non autorise a supprimer ce flash',
        };
      }

      await this.prisma.flash.delete({
        where: { id },
      });

      await this.cacheService.del(`flashs:salon:${existingFlash.userId}:available`);

      return {
        error: false,
        message: 'Flash supprime avec succes',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
