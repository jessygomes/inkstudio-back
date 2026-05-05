import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async createArticle(createArticleDto: CreateArticleDto) {
    try {
      const article = await this.prisma.article.create({
        data: {
          title: createArticleDto.title.trim(),
          content: createArticleDto.content.trim(),
          author: createArticleDto.author.trim(),
          imageUrls: createArticleDto.imageUrls,
        },
      });

      await this.cacheService.del('articles:public:list');
      await this.cacheService.del('articles:public:latest:3');

      return {
        error: false,
        message: 'Article créé avec succès',
        article,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getPublicArticles() {
    try {
      const cacheKey = 'articles:public:list';

      const cached = await this.cacheService.get<
        {
          id: string;
          title: string;
          content: string;
          author: string;
          imageUrls: string[];
          createdAt: Date;
          updatedAt: Date;
        }[]
      >(cacheKey);

      if (cached) {
        return cached;
      }

      const articles = await this.prisma.article.findMany({
        select: {
          id: true,
          title: true,
          content: true,
          author: true,
          imageUrls: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      await this.cacheService.set(cacheKey, articles, 900);

      return articles;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getLatestPublicArticles() {
    try {
      const cacheKey = 'articles:public:latest:3';

      const cached = await this.cacheService.get<
        {
          id: string;
          title: string;
          content: string;
          author: string;
          imageUrls: string[];
          createdAt: Date;
          updatedAt: Date;
        }[]
      >(cacheKey);

      if (cached) {
        return cached;
      }

      const latestArticles = await this.prisma.article.findMany({
        select: {
          id: true,
          title: true,
          content: true,
          author: true,
          imageUrls: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 3,
      });

      await this.cacheService.set(cacheKey, latestArticles, 900);

      return latestArticles;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getPublicArticleById(id: string) {
    try {
      const article = await this.prisma.article.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          content: true,
          author: true,
          imageUrls: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!article) {
        return {
          error: true,
          message: 'Article non trouve',
        };
      }

      return article;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getAdminArticles() {
    try {
      return await this.prisma.article.findMany({
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async updateArticle(id: string, updateArticleDto: UpdateArticleDto) {
    try {
      const existingArticle = await this.prisma.article.findUnique({
        where: { id },
      });

      if (!existingArticle) {
        return {
          error: true,
          message: 'Article non trouve',
        };
      }

      const updatedArticle = await this.prisma.article.update({
        where: { id },
        data: {
          title: updateArticleDto.title?.trim(),
          content: updateArticleDto.content?.trim(),
          author: updateArticleDto.author?.trim(),
          imageUrls: updateArticleDto.imageUrls,
        },
      });

      await this.cacheService.del('articles:public:list');
      await this.cacheService.del('articles:public:latest:3');

      return {
        error: false,
        message: 'Article mis a jour avec succes',
        article: updatedArticle,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async deleteArticle(id: string) {
    try {
      const existingArticle = await this.prisma.article.findUnique({
        where: { id },
      });

      if (!existingArticle) {
        return {
          error: true,
          message: 'Article non trouve',
        };
      }

      await this.prisma.article.delete({
        where: { id },
      });

      await this.cacheService.del('articles:public:list');
      await this.cacheService.del('articles:public:latest:3');

      return {
        error: false,
        message: 'Article supprime avec succes',
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
