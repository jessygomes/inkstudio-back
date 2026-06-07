import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
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

  private normalizeStyles(styleInput: unknown): string[] {
    return Array.isArray(styleInput)
      ? [
          ...new Set(
            styleInput
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean),
          ),
        ]
      : [];
  }

  private async validateTatoueurForSalon(tatoueurId: string, userId: string) {
    const tatoueur = await this.prisma.tatoueur.findFirst({
      where: {
        id: tatoueurId,
        userId,
      },
      select: { id: true },
    });

    if (!tatoueur) {
      return {
        error: true,
        message: 'Le tatoueur sélectionné est introuvable pour ce salon.',
      };
    }

    return null;
  }

  private async invalidateFlashCacheForUser(userId: string) {
    await this.cacheService.delPattern(`flashs:salon:${userId}:available:*`);
    await this.cacheService.delPattern(`flashs:salon:${userId}:all:*`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { salonId: true },
    });

    if (user?.salonId) {
      await this.cacheService.delPattern(`flashs:salon:${user.salonId}:available:*`);
      await this.cacheService.delPattern(`flashs:salon:${user.salonId}:all:*`);
    }
  }

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
      const normalizedStyles = this.normalizeStyles(
        (createFlashDto as { style?: unknown }).style,
      );
      const tatoueurIdRaw = (createFlashDto as { tatoueurId?: unknown }).tatoueurId;
      const tatoueurId = typeof tatoueurIdRaw === 'string' ? tatoueurIdRaw : undefined;

      if (tatoueurId) {
        const tatoueurValidation = await this.validateTatoueurForSalon(
          tatoueurId,
          userId,
        );
        if (tatoueurValidation) {
          return tatoueurValidation;
        }
      }

      const flash = await this.prisma.flash.create({
        data: {
          userId,
          tatoueurId,
          title: createFlashDto.title,
          style: normalizedStyles,
          dimension,
          imageUrl: createFlashDto.imageUrl,
          price: createFlashDto.price,
          description: createFlashDto.description,
          isAvailable: createFlashDto.isAvailable ?? true,
        },
      });

      await this.invalidateFlashCacheForUser(userId);

      return {
        error: false,
        message: 'Flash créé avec succès',
        flash,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue';
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
            style: string[];
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

      const requestedUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          linkedTatoueurs: {
            select: {
              id: true,
            },
          },
        },
      });

      const linkedTatoueurUserIds = requestedUser?.role === Role.user_salon
        ? (requestedUser.linkedTatoueurs ?? []).map((tatoueurUser) => tatoueurUser.id)
        : [];

      const flashOwnerIds = Array.from(new Set([userId, ...linkedTatoueurUserIds]));

      const whereClause = {
        userId:
          flashOwnerIds.length === 1
            ? flashOwnerIds[0]
            : { in: flashOwnerIds },
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
      const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getAllFlashsByUser(userId: string, page: number = 1, isAvailable?: boolean) {
    try {
      const pageSize = 10;
      const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;
      const skip = (currentPage - 1) * pageSize;
      const availabilityScope =
        isAvailable === undefined ? 'all' : isAvailable ? 'available' : 'unavailable';
      const cacheKey = `flashs:salon:${userId}:all:availability:${availabilityScope}:page:${currentPage}`;

      const cached = await this.cacheService.get<
        {
          flashs: {
            id: string;
            title: string;
            style: string[];
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

      const requestedUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          linkedTatoueurs: {
            select: {
              id: true,
            },
          },
        },
      });

      const linkedTatoueurUserIds = requestedUser?.role === Role.user_salon
        ? (requestedUser.linkedTatoueurs ?? []).map((tatoueurUser) => tatoueurUser.id)
        : [];

      const flashOwnerIds = Array.from(new Set([userId, ...linkedTatoueurUserIds]));

      const whereClause = {
        userId:
          flashOwnerIds.length === 1
            ? flashOwnerIds[0]
            : { in: flashOwnerIds },
        ...(isAvailable !== undefined ? { isAvailable } : {}),
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
      const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue';
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
          message: 'Flash non trouvé',
        };
      }

      if (existingFlash.userId !== userId) {
        return {
          error: true,
          message: 'Non autorisé à modifier ce flash',
        };
      }

      const updateTatoueurIdRaw = (updateFlashDto as { tatoueurId?: unknown }).tatoueurId;
      const updateTatoueurId = typeof updateTatoueurIdRaw === 'string' ? updateTatoueurIdRaw : undefined;

      if (updateTatoueurId) {
        const tatoueurValidation = await this.validateTatoueurForSalon(
          updateTatoueurId,
          userId,
        );
        if (tatoueurValidation) {
          return tatoueurValidation;
        }
      }

      const updatedFlash = await this.prisma.flash.update({
        where: { id },
        data: {
          ...updateFlashDto,
          ...(updateFlashDto.style !== undefined
            ? {
                style: this.normalizeStyles(
                  (updateFlashDto as { style?: unknown }).style,
                ),
              }
            : {}),
        },
      });

      await this.invalidateFlashCacheForUser(existingFlash.userId);

      return {
        error: false,
        message: 'Flash mis à jour avec succès',
        flash: updatedFlash,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue';
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
          message: 'Flash non trouvé',
        };
      }

      if (existingFlash.userId !== userId) {
        return {
          error: true,
          message: 'Non autorisé à supprimer ce flash',
        };
      }

      await this.prisma.flash.delete({
        where: { id },
      });

      await this.invalidateFlashCacheForUser(existingFlash.userId);

      return {
        error: false,
        message: 'Flash supprimé avec succès',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
