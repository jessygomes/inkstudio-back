import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  // Request,
  // UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { StocksService } from './stocks.service';
import { CreateStockDto } from './dto/create-item.dto';
import { UpdateQuantityDto } from './dto/update-quantity.dto';

@Controller('stocks')
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  // ------------------------------------ 1️⃣ ROUTES STATIQUES SPÉCIFIQUES EN PREMIER
  //! VOIR TOUS LE STOCK D'UN SALON ✅
  @UseGuards(JwtAuthGuard)
  @Get('salon')
  async getStocksBySalon(@Request() req: RequestWithUser, @Query('page') page?: string, @Query('limit') limit?: string,  @Query('search') search: string = '') {
    const userId = req.user.userId;
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return this.stocksService.getStocksBySalon(userId, pageNumber, limitNumber, search);
  }

  //! RECUPERER LES CATEGORIES DES ITEMS DE STOCK D'UN SALON ✅
  @UseGuards(JwtAuthGuard)
  @Get('categories')
  async getItemCategories(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.stocksService.getItemCategories(userId);
  }

  // ---------------------------------- 2️⃣ ROUTES AVEC ACTIONS SPÉCIFIQUES
  //! CREER UN ITEM ✅
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req: RequestWithUser, @Body() stockBody: CreateStockDto) {
    const userId = req.user.userId;
    return this.stocksService.createItemStock({ stockBody, userId });
  }

  // ------------------------------- 3️⃣ ROUTES AVEC PARAMÈTRES EN DERNIER
  //! VOIR UN SEUL ÉLÉMENT DE STOCK ✅
  @Get(':id')
  getOneStockItem(@Param('id') id: string) {
    return this.stocksService.getStockItemById(id);
  }

  //! MODIFIER UN ITEM ✅
  @UseGuards(JwtAuthGuard)
  @Patch('update/:id')
  updateItem(@Param('id') id: string, @Body() itemBody: CreateStockDto) {
    return this.stocksService.updateStockItem(id, itemBody);
  }

    //! MODIFIER UNIQUEMENT LA QUANTITÉ D'UN ITEM ✅
  @UseGuards(JwtAuthGuard)
  @Patch('updateQuantity/:id')
  updateQuantityItem(@Param('id') id: string, @Body() updateQuantityDto: UpdateQuantityDto) {
    return this.stocksService.updateStockQuantityItem(id, updateQuantityDto.quantity);
  }  
  
  //! SUPPRIMER UN ITEM ✅
  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  deleteItem(@Param('id') id: string) {
    return this.stocksService.deleteStockItem(id);
  }
}
