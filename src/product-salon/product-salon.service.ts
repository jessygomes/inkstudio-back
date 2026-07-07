import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CacheService } from 'src/redis/cache.service';

@Injectable()
export class ProductSalonService {
  constructor(
    private readonly prisma: PrismaService,
    private cacheService: CacheService
  ) {}

  //! CRÉER UN NOUVEAU PRODUIT
  async createProduct(createProductDto: CreateProductDto, userId: string) {
    try {
      const { name, description, price, imageUrl } = createProductDto;

      // Vérifier si l'utilisateur existe
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return {
          error: true,
          message: 'Utilisateur non trouvé',
        };
      }

      // Créer le produit
      const newProduct = await this.prisma.productSalon.create({
        data: {
          userId,
          name,
          description,
          price,
          imageUrl,
        },
      });

      // Invalider le cache après création
      await this.cacheService.del(`products:salon:${userId}`);

      return {
        error: false,
        message: 'Produit créé avec succès',
        product: newProduct,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! RÉCUPÉRER TOUS LES PRODUITS
  async getAllProducts(userId: string, page: number = 1) {
    try {
      const pageSize = 10;
      const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;
      const skip = (currentPage - 1) * pageSize;
      const cacheKey = `products:salon:${userId}:page:${currentPage}`;

      // 1. Vérifier dans Redis
      const cachedProducts = await this.cacheService.get<{
        products: {
          id: string;
          name: string;
          description: string;
          price: number;
          imageUrl: string;
          [key: string]: any;
        }[];
        pagination: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>(cacheKey);
      
      if (cachedProducts) {
        return cachedProducts;
      }

      const whereClause = { userId };

      const total = await this.prisma.productSalon.count({
        where: whereClause,
      });

      // 2. Sinon, aller chercher en DB
      const products = await this.prisma.productSalon.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' }, // Optionnel : trier par date de création
        skip,
        take: pageSize,
      });

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const response = {
        products,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };

      // 3. Mettre en cache (TTL 20 minutes pour les produits salon)
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

  //! MODIFIER UN PRODUIT
  async updateProduct(id: string, updateData: Partial<CreateProductDto>, userId: string) {
    try {
      // Vérifier si le produit existe
      const existingProduct = await this.prisma.productSalon.findUnique({
        where: { id },
      });

      if (!existingProduct) {
        return {
          error: true,
          message: 'Produit non trouvé',
        };
      }

      if (existingProduct.userId !== userId) {
        return {
          error: true,
          message: 'Non autorisé à modifier ce produit.',
        };
      }

      // Mettre à jour le produit
      const updatedProduct = await this.prisma.productSalon.update({
        where: { id },
        data: updateData,
      });

      // Invalider le cache après mise à jour
      await this.cacheService.del(`products:salon:${existingProduct.userId}`);

      return {
        error: false,
        message: 'Produit mis à jour avec succès',
        product: updatedProduct,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! SUPPRIMER UN PRODUIT
  async deleteProduct(id: string, userId: string) {
    try {
      // Vérifier si le produit existe
      const existingProduct = await this.prisma.productSalon.findUnique({
        where: { id },
      });

      if (!existingProduct) {
        throw new Error('Produit non trouvé');
      }

      if (existingProduct.userId !== userId) {
        return {
          error: true,
          message: 'Non autorisé à supprimer ce produit.',
        };
      }

      // Supprimer le produit
      await this.prisma.productSalon.delete({
        where: { id },
      });

      // Invalider le cache après suppression
      await this.cacheService.del(`products:salon:${existingProduct.userId}`);

      return {
        error: false,
        message: 'Produit supprimé avec succès',
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
