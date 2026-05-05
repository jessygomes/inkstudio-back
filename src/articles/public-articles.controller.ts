import { Controller, Get, Param } from '@nestjs/common';
import { ArticlesService } from './articles.service';

@Controller('articles')
export class PublicArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  async getPublicArticles() {
    return this.articlesService.getPublicArticles();
  }

  @Get('latest')
  async getLatestPublicArticles() {
    return this.articlesService.getLatestPublicArticles();
  }

  @Get(':id')
  async getPublicArticleById(@Param('id') id: string) {
    return this.articlesService.getPublicArticleById(id);
  }
}
