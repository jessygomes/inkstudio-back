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
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@Controller('admin/articles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Post()
  async createArticle(@Request() req: RequestWithUser, @Body() createArticleDto: CreateArticleDto) {
    return this.articlesService.createArticle(req.user.role, createArticleDto);
  }

  @Get()
  async getAdminArticles(@Request() req: RequestWithUser) {
    return this.articlesService.getAdminArticles(req.user.role);
  }

  @Patch(':id')
  async updateArticle(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateArticleDto: UpdateArticleDto,
  ) {
    return this.articlesService.updateArticle(req.user.role, id, updateArticleDto);
  }

  @Delete(':id')
  async deleteArticle(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.articlesService.deleteArticle(req.user.role, id);
  }
}
