import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { FlashService } from './flash.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreateFlashDto } from './dto/create-flash.dto';
import { UpdateFlashDto } from './dto/update-flash.dto';

@Controller('flash')
export class FlashController {
  constructor(private readonly flashService: FlashService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async createFlash(@Request() req: RequestWithUser, @Body() createFlashDto: CreateFlashDto) {
    const userId = req.user.userId;
    return this.flashService.createFlash(createFlashDto, userId);
  }

  @Get(':userId')
  async getAvailableFlashsByUser(@Param('userId') userId: string) {
    return this.flashService.getAvailableFlashsByUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateFlash(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateFlashDto: UpdateFlashDto,
  ) {
    const userId = req.user.userId;
    return this.flashService.updateFlash(id, updateFlashDto, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteFlash(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.flashService.deleteFlash(id, userId);
  }
}
