import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateStockDto } from './dto/create-item.dto';

@Injectable()
export class StocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasService: SaasService,
    private cacheService: CacheService
  ) {}

  async createItemStock({ stockBody, userId }: { stockBody: CreateStockDto, userId: string }) {
    try {
      const { name, category, quantity, unit, minQuantity, pricePerUnit } = stockBody;


      // Créer l'élément de stock
      const newStockItem = await this.prisma.stockItem.create({
        data: {
          userId,
          name,
          category,
          quantity,
          unit,
          minQuantity,
          pricePerUnit,
        },
      });

      // Invalider le cache des listes de stocks après création
      await this.cacheService.delPattern(`stocks:salon:${userId}:*`);

      return {
        error: false,
        message: 'Élément de stock créé avec succès.',
        stockItem: newStockItem,
      };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR TOUS LES STOCKS D'UN SALON
  async getStocksBySalon(userId: string, page: number, limit: number, search: string) {
    try {
      const skip = (page - 1) * limit;

      // Créer une clé de cache basée sur les paramètres
      const cacheKey = `stocks:salon:${userId}:${JSON.stringify({
        page,
        limit,
        search: search?.trim() || null
      })}`;

      // 1. Vérifier dans Redis
      const cachedResult = await this.cacheService.get<{
        error: boolean;
        stockItems: any[];
        pagination: any;
      }>(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      // Construire les conditions de recherche
      const searchConditions = search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { category: { contains: search, mode: 'insensitive' as const } },
              { unit: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const whereClause = {
        userId,
        ...searchConditions,
      };

      const totalStockItems = await this.prisma.stockItem.count({
        where: whereClause,
      });

      const stockItemsFromDb = await this.prisma.stockItem.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      // Calculer le prix total pour chaque élément
      const stockItems = stockItemsFromDb.map(item => ({
        ...item,
        totalPrice: item.pricePerUnit ? item.quantity * item.pricePerUnit : null
      }));

      const totalPages = Math.ceil(totalStockItems / limit);

      if (!stockItems || stockItems.length === 0) {
        throw new Error('Aucun élément de stock trouvé.');
      }

      // Vérifier si le salon a des éléments de stock
      if (stockItems.length === 0) {
        throw new Error('Aucun élément de stock trouvé pour votre salon.');
      }

      const result = {
        error: false,
        stockItems,
        pagination: {
          currentPage: page,
          totalPages,
          totalStockItems,
          limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        }
      };

      // 3. Mettre en cache (TTL 5 minutes pour les listes de stocks)
      await this.cacheService.set(cacheKey, result, 300);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! VOIR UN SEUL ÉLÉMENT DE STOCK
  async getStockItemById(id: string) {
    try {
      const cacheKey = `stockitem:${id}`;

      // 1. Vérifier dans Redis
      const cachedStockItem = await this.cacheService.get<{
        id: string;
        name: string;
        category: string;
        quantity: number;
        unit: string;
        minQuantity: number;
        [key: string]: any;
      }>(cacheKey);
      
      if (cachedStockItem) {
        return cachedStockItem;
      }

      // 2. Sinon, aller chercher en DB
      const stockItem = await this.prisma.stockItem.findUnique({
        where: { id },
      });

      if (!stockItem) {
        throw new Error('Élément de stock introuvable.');
      }

      // 3. Mettre en cache (TTL 10 minutes pour un élément spécifique)
      await this.cacheService.set(cacheKey, stockItem, 600);

      return stockItem;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      }; 
    }
  }

  //! METTRE À JOUR UN ÉLÉMENT DE STOCK
  async updateStockItem(id: string, stockBody: Partial<CreateStockDto>) {
    try {
      const updatedStockItem = await this.prisma.stockItem.update({
        where: { id },
        data: stockBody,
      });

      // Invalider le cache de l'élément spécifique
      await this.cacheService.del(`stockitem:${id}`);
      // Invalider le cache des listes de stocks du salon
      await this.cacheService.delPattern(`stocks:salon:${updatedStockItem.userId}:*`);

      return {
        error: false,
        message: 'Élément de stock mis à jour avec succès.',
        stockItem: updatedStockItem,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! Recuperer les catégories d'items de stock d'un salon
  async getItemCategories(userId: string) {
    try {
      const categories = await this.prisma.stockItem.findMany({
        where: { userId },
        distinct: ['category'],
        select: { category: true },
      });
      return categories.map(cat => cat.category).filter(cat => cat); // Filtrer les catégories nulles ou vides
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! METTRE À JOUR UNIQUEMENT LA QUANTITÉ D'UN ÉLÉMENT DE STOCK
  async updateStockQuantityItem(id: string, quantity: number) {
    try {
      // Validation de la quantité
      if (quantity < 0) {
        return {
          error: true,
          message: 'La quantité ne peut pas être négative.',
          stockItem: null,
        };
      }

      // Vérifier si l'élément existe
      const existingItem = await this.prisma.stockItem.findUnique({
        where: { id },
      });

      if (!existingItem) {
        return {
          error: true,
          message: 'Élément de stock non trouvé.',
          stockItem: null,
        };
      }

      const updatedStockItem = await this.prisma.stockItem.update({
        where: { id },
        data: { quantity },
      });

      // Invalider le cache de l'élément spécifique
      await this.cacheService.del(`stockitem:${id}`);
      // Invalider le cache des listes de stocks du salon
      await this.cacheService.delPattern(`stocks:salon:${updatedStockItem.userId}:*`);

      return {
        error: false,
        message: 'Quantité mise à jour avec succès.',
        stockItem: updatedStockItem,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: `Erreur lors de la mise à jour de la quantité: ${errorMessage}`,
      };
    }
  }

  //! SUPPRIMER UN ÉLÉMENT DE STOCK
  async deleteStockItem(id: string) {
    try {
      // Récupérer l'élément avant suppression pour l'invalidation du cache
      const stockToDelete = await this.prisma.stockItem.findUnique({
        where: { id },
        select: { userId: true }
      });

      if (!stockToDelete) {
        return {
          error: true,
          message: 'Élément de stock introuvable.',
        };
      }

      const deletedStockItem = await this.prisma.stockItem.delete({
        where: { id },
      });

      // Invalider le cache de l'élément spécifique
      await this.cacheService.del(`stockitem:${id}`);
      // Invalider le cache des listes de stocks du salon
      await this.cacheService.delPattern(`stocks:salon:${stockToDelete.userId}:*`);

      return {
        error: false,
        message: 'Élément de stock supprimé avec succès.',
        stockItem: deletedStockItem,
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
