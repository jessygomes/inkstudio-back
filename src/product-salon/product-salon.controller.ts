import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ProductSalonService } from './product-salon.service';
import { CreateProductDto } from './dto/create-product.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('product-salon')
export class ProductSalonController {
  constructor(private readonly productSalonService: ProductSalonService) {}

  //! CRÉER UN NOUVEAU PRODUIT
  @UseGuards(JwtAuthGuard)
  @Post()
  async createProduct(@Request() req: RequestWithUser, @Body() createProductDto: CreateProductDto) {
    const userId = req.user.userId;
    return this.productSalonService.createProduct(createProductDto, userId);
  }

  //! RÉCUPÉRER TOUS LES PRODUITS
  @Get(':userId')
  async getAllProducts(@Param('userId') userId: string, @Query('page') page?: string) {
    const pageNumber = page ? Number.parseInt(page, 10) : 1;
    return this.productSalonService.getAllProducts(userId, pageNumber);
  }

  //! MODIFIER UN PRODUIT
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateProduct(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateData: Partial<CreateProductDto>,
  ) {
    const userId = req.user.userId;
    return this.productSalonService.updateProduct(id, updateData, userId);
  }

  //! SUPPRIMER UN PRODUIT
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteProduct(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.productSalonService.deleteProduct(id, userId);
  }
}
