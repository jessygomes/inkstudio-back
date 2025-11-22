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
  async getAllProducts(userId: string) {
    try {
      const cacheKey = `products:salon:${userId}`;

      // 1. Vérifier dans Redis
      const cachedProducts = await this.cacheService.get<{
        id: string;
        name: string;
        description: string;
        price: number;
        imageUrl: string;
        [key: string]: any;
      }[]>(cacheKey);
      
      if (cachedProducts) {
        return cachedProducts;
      }

      // 2. Sinon, aller chercher en DB
      const products = await this.prisma.productSalon.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }, // Optionnel : trier par date de création
      });

      // 3. Mettre en cache (TTL 20 minutes pour les produits salon)
      await this.cacheService.set(cacheKey, products, 1200);

      return products;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! MODIFIER UN PRODUIT
  async updateProduct(id: string, updateData: Partial<CreateProductDto>) {
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
  async deleteProduct(id: string) {
    try {
      // Vérifier si le produit existe
      const existingProduct = await this.prisma.productSalon.findUnique({
        where: { id },
      });

      if (!existingProduct) {
        throw new Error('Produit non trouvé');
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
