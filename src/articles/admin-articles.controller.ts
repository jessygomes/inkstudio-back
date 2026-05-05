import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@Controller('admin/articles')
export class AdminArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async createArticle(@Request() req: RequestWithUser, @Body() createArticleDto: CreateArticleDto) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Acces reserve aux administrateurs.',
      };
    }

    return this.articlesService.createArticle(createArticleDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getAdminArticles(@Request() req: RequestWithUser) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Acces reserve aux administrateurs.',
      };
    }

    return this.articlesService.getAdminArticles();
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateArticle(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateArticleDto: UpdateArticleDto,
  ) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Acces reserve aux administrateurs.',
      };
    }

    return this.articlesService.updateArticle(id, updateArticleDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteArticle(@Request() req: RequestWithUser, @Param('id') id: string) {
    if (req.user.role !== 'admin') {
      return {
        error: true,
        message: 'Acces reserve aux administrateurs.',
      };
    }

    return this.articlesService.deleteArticle(id);
  }
}
