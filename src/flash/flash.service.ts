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

      const flash = await this.prisma.flash.create({
        data: {
          userId,
          title: createFlashDto.title,
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

  async getAvailableFlashsByUser(userId: string) {
    try {
      const cacheKey = `flashs:salon:${userId}:available`;

      const cached = await this.cacheService.get<
        {
          id: string;
          title: string;
          imageUrl: string;
          description: string | null;
          price: number;
          isAvailable: boolean;
        }[]
      >(cacheKey);

      if (cached) {
        return cached;
      }

      const flashs = await this.prisma.flash.findMany({
        where: {
          userId,
          isAvailable: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      await this.cacheService.set(cacheKey, flashs, 1200);

      return flashs;
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
