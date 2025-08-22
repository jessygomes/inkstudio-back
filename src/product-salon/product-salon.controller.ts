import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
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
  async getAllProducts(@Param('userId') userId: string) {
    return this.productSalonService.getAllProducts(userId);
  }

  //! MODIFIER UN PRODUIT
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateProduct(@Param('id') id: string, @Body() updateData: Partial<CreateProductDto>) {
    return this.productSalonService.updateProduct(id, updateData);
  }

  //! SUPPRIMER UN PRODUIT
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteProduct(@Param('id') id: string) {
    return this.productSalonService.deleteProduct(id);
  }
}
