import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProductSalonService } from './product-salon.service';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('product-salon')
export class ProductSalonController {
  constructor(private readonly productSalonService: ProductSalonService) {}

  //! CRÉER UN NOUVEAU PRODUIT
  @Post()
  async createProduct(@Body() createProductDto: CreateProductDto) {
    return this.productSalonService.createProduct(createProductDto);
  }

  //! RÉCUPÉRER TOUS LES PRODUITS
  @Get(':userId')
  async getAllProducts(@Param('userId') userId: string) {
    return this.productSalonService.getAllProducts(userId);
  }

  //! MODIFIER UN PRODUIT
  @Patch(':id')
  async updateProduct(@Param('id') id: string, @Body() updateData: Partial<CreateProductDto>) {
    return this.productSalonService.updateProduct(id, updateData);
  }

  //! SUPPRIMER UN PRODUIT
  @Delete(':id')
  async deleteProduct(@Param('id') id: string) {
    return this.productSalonService.deleteProduct(id);
  }
}
