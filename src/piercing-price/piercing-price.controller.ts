import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PiercingPriceService } from './piercing-price.service';
import { PiercingZone, PiercingZoneOreille, PiercingZoneVisage, PiercingZoneBouche, PiercingZoneCorps, PiercingZoneMicrodermal } from '@prisma/client';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreatePiercingServicePriceDto } from './dto/create-piercing-service-price.dto';
import { CreatePiercingPriceDto } from './dto/create-piercing-price.dto';

@Controller('piercing-prices')
export class PiercingPriceController {
  constructor(private readonly piercingPriceService: PiercingPriceService) {}

  // Endpoints pour récupérer les enums (routes spécifiques en premier)
  @Get('enums/zones')
  getPiercingZoneEnums() {
    return Object.values(PiercingZone as unknown as { [s: string]: unknown });
  }

  @Get('enums/zone-oreille')
  getPiercingZoneOreilleEnums() {
    return Object.values(PiercingZoneOreille as unknown as { [s: string]: unknown });
  }

  @Get('enums/zone-visage')
  getPiercingZoneVisageEnums() {
    return Object.values(PiercingZoneVisage as unknown as { [s: string]: unknown });
  }

  @Get('enums/zone-bouche')
  getPiercingZoneBoucheEnums() {
    return Object.values(PiercingZoneBouche as unknown as { [s: string]: unknown });
  }

  @Get('enums/corps')
  getPiercingCorpsEnums() {
    return Object.values(PiercingZoneCorps as unknown as { [s: string]: unknown });
  }

  @Get('enums/zone-microdermal')
  getPiercingZoneMicrodermalEnums() {
    return Object.values(PiercingZoneMicrodermal as unknown as { [s: string]: unknown });
  }

  @Get('enums/specific-zones/:zone')
  getSpecificZonesByType(@Param('zone') zone: PiercingZone) {
    switch (zone) {
      case PiercingZone.OREILLE:
        return Object.values(PiercingZoneOreille as unknown as { [s: string]: unknown });
      case PiercingZone.VISAGE:
        return Object.values(PiercingZoneVisage as unknown as { [s: string]: unknown });
      case PiercingZone.BOUCHE:
        return Object.values(PiercingZoneBouche as unknown as { [s: string]: unknown });
      case PiercingZone.CORPS:
        return Object.values(PiercingZoneCorps as unknown as { [s: string]: unknown });
      case PiercingZone.MICRODERMAL:
        return Object.values(PiercingZoneMicrodermal as unknown as { [s: string]: unknown });
      default:
        return [];
    }
  }

  // Endpoints utilitaires (routes spécifiques avant les routes avec paramètres)


  @Get('overview')
  @UseGuards(JwtAuthGuard)
  getSalonPricingOverview(@Request() req: RequestWithUser) {
    return this.piercingPriceService.getSalonPricingOverview(req.user.userId);
  }

  @Get('available-zones')
  getAvailableZonesForConfiguration(@Request() req: RequestWithUser) {
    return this.piercingPriceService.getAvailableZonesForConfiguration(req.user.userId);
  }

  // Services de piercing (zones spécifiques avec prix)
  @Get('services')
  getServicePrices(@Request() req: RequestWithUser, @Query('piercingPriceId') piercingPriceId?: string) {
    return this.piercingPriceService.getServicePrices(req.user.userId, piercingPriceId);
  }

  @Post('services')
  @UseGuards(JwtAuthGuard)
  createServicePrice(@Request() req: RequestWithUser, @Body() createServicePriceDto: CreatePiercingServicePriceDto) {
    return this.piercingPriceService.createServicePrice(req.user.userId, createServicePriceDto);
  }

  @Get('services/:id')
  @UseGuards(JwtAuthGuard)
  getServicePriceById(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.piercingPriceService.getServicePriceById(req.user.userId, id);
  }

  @Patch('services/:id')
  @UseGuards(JwtAuthGuard)
  updateServicePrice(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateServicePriceDto: any,
  ) {
    return this.piercingPriceService.updateServicePrice(req.user.userId, id, updateServicePriceDto);
  }

  @Delete('services/:id')
  @UseGuards(JwtAuthGuard)
  deleteServicePrice(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.piercingPriceService.deleteServicePrice(req.user.userId, id);
  }

    @Get('configuration/:userId')
  getSalonPiercingConfiguration(@Param('userId') userId: string) {
    return this.piercingPriceService.getSalonPiercingConfiguration(userId);
  }

  // Types de piercing (zones générales)
  @Get('zones')
  getPiercingZones(@Request() req: RequestWithUser) {
    return this.piercingPriceService.getPiercingZones(req.user.userId);
  }

  @Post('zones')
  @UseGuards(JwtAuthGuard)
  createPiercingZone(@Request() req: RequestWithUser, @Body() createPiercingPriceDto: CreatePiercingPriceDto) {
    return this.piercingPriceService.createPiercingZone(req.user.userId, createPiercingPriceDto);
  }

  @Patch('zones/:id')
  @UseGuards(JwtAuthGuard)
  updatePiercingZone(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updatePiercingPriceDto: CreatePiercingPriceDto,
  ) {
    return this.piercingPriceService.updatePiercingZone(req.user.userId, id, updatePiercingPriceDto);
  }

  @Delete('zones/:id')
  @UseGuards(JwtAuthGuard)
  deletePiercingZone(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.piercingPriceService.deletePiercingZone(req.user.userId, id);
  }
}