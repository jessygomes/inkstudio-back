import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePiercingPriceDto } from './dto/create-piercing-price.dto';
import { CreatePiercingServicePriceDto } from './dto/create-piercing-service-price.dto';

@Injectable()
export class PiercingPriceService {
  constructor(private readonly prisma: PrismaService) {}

  //! Créer une zone de piercing proposée par le salon
  async createPiercingZone(userId: string, createPiercingPriceDto: CreatePiercingPriceDto) {
    const existingZone = await this.prisma.piercingPrice.findUnique({
      where: {
        userId_piercingZone: {
          userId,
          piercingZone: createPiercingPriceDto.piercingZone,
        },
      },
    });

    if (existingZone) {
      throw new BadRequestException('Cette zone de piercing est déjà configurée');
    }

    return this.prisma.piercingPrice.create({
      data: {
        userId,
        piercingZone: createPiercingPriceDto.piercingZone,
        isActive: createPiercingPriceDto.isActive ?? true,
      },
      include: {
        services: true,
      },
    });
  }

  //! Obtenir toutes les zones de piercings d'un salon
  async getPiercingZones(userId: string) {
    return this.prisma.piercingPrice.findMany({
      where: { userId },
      include: {
        services: true,
      },
    });
  }

  //! Mettre à jour une zone de piercing
  async updatePiercingZone(userId: string, id: string, updatePiercingPriceDto: Partial<CreatePiercingPriceDto>) {
    const piercingZone = await this.prisma.piercingPrice.findFirst({
      where: { id, userId },
    });

    if (!piercingZone) {
      throw new NotFoundException('Zone de piercing non trouvée');
    }

    return this.prisma.piercingPrice.update({
      where: { id },
      data: updatePiercingPriceDto,
      include: {
        services: true,
      },
    });
  }

  //! Supprimer une zone de piercing
  async deletePiercingZone(userId: string, id: string) {
    const piercingZone = await this.prisma.piercingPrice.findFirst({
      where: { id, userId },
    });

    if (!piercingZone) {
      throw new NotFoundException('Zone de piercing non trouvée');
    }

    return this.prisma.piercingPrice.delete({
      where: { id },
    });
  }

  //! Créer un prix pour un service spécifique
  async createServicePrice(userId: string, createServicePriceDto: CreatePiercingServicePriceDto) {
    const piercingZone = await this.prisma.piercingPrice.findFirst({
      where: {
        id: createServicePriceDto.piercingPriceId,
        userId,
      },
    });

    if (!piercingZone) {
      throw new NotFoundException('Zone de piercing non trouvée');
    }

    // Vérifier qu'au moins une zone spécifique est définie
    const hasSpecificZone = !!(
      createServicePriceDto.piercingZoneOreille || 
      createServicePriceDto.piercingZoneVisage || 
      createServicePriceDto.piercingZoneBouche || 
      createServicePriceDto.piercingZoneCorps ||
      createServicePriceDto.piercingZoneMicrodermal
    );

    if (!hasSpecificZone) {
      throw new BadRequestException('Vous devez spécifier au moins une zone spécifique');
    }

    return this.prisma.piercingServicePrice.create({
      data: {
        ...createServicePriceDto,
        userId,
      },
      include: {
        piercingPrice: true,
      },
    });
  }

  //! Obtenir tous les prix de services d'un salon
  async getServicePrices(userId: string, piercingPriceId?: string) {
    const where: { userId: string; piercingPriceId?: string } = { userId };
    if (piercingPriceId) {
      where.piercingPriceId = piercingPriceId;
    }

    return this.prisma.piercingServicePrice.findMany({
      where,
      include: {
        piercingPrice: true,
      },
    });
  }

  //! Mettre à jour un prix de service
  async updateServicePrice(userId: string, id: string, updateServicePriceDto: Partial<CreatePiercingServicePriceDto>) {
    const servicePrice = await this.prisma.piercingServicePrice.findFirst({
      where: { id, userId },
    });

    if (!servicePrice) {
      throw new NotFoundException('Prix de service non trouvé');
    }

    return this.prisma.piercingServicePrice.update({
      where: { id },
      data: updateServicePriceDto,
      include: {
        piercingPrice: true,
      },
    });
  }

  //! Supprimer un prix de service
  async deleteServicePrice(userId: string, id: string) {
    const servicePrice = await this.prisma.piercingServicePrice.findFirst({
      where: { id, userId },
    });

    if (!servicePrice) {
      throw new NotFoundException('Prix de service non trouvé');
    }

    return this.prisma.piercingServicePrice.delete({
      where: { id },
    });
  }

  //! Obtenir le prix d'un service spécifique
  // async getSpecificServicePrice(userId: string, searchCriteria: any) {
  //   return this.prisma.piercingServicePrice.findFirst({
  //     where: {
  //       userId,
  //       ...searchCriteria,
  //       isActive: true,
  //     },
  //     include: {
  //       piercingPrice: true,
  //     },
  //   });
  // }

  //! Obtenir un aperçu complet des zones et prix configurés par le salon
  async getSalonPricingOverview(userId: string) {
    const zones = await this.prisma.piercingPrice.findMany({
      where: { userId, isActive: true },
      include: {
        services: {
          where: { isActive: true },
          orderBy: { price: 'asc' }
        },
      },
      orderBy: { piercingZone: 'asc' }
    });

    return zones.map(zone => ({
      id: zone.id,
      piercingZone: zone.piercingZone,
      isActive: zone.isActive,
      servicesCount: zone.services.length,
      services: zone.services.map(service => ({
        id: service.id,
        specificZone: !!(
        service.piercingZoneOreille || 
        service.piercingZoneVisage || 
        service.piercingZoneBouche || 
        service.piercingZoneCorps ||
        service.piercingZoneMicrodermal
        ),
        price: service.price,
        description: service.description
      }))
    }));
  }

  // Obtenir les zones disponibles pour la configuration (pas encore configurées)
  async getAvailableZonesForConfiguration(userId: string) {
    const configuredZones = await this.prisma.piercingPrice.findMany({
      where: { userId },
      select: { piercingZone: true }
    });

    const allZones = ['OREILLE', 'VISAGE', 'BOUCHE', 'CORPS', 'MICRODERMAL', 'AUTRE'];
    const configuredZoneNames = configuredZones.map(z => z.piercingZone);
    
    return allZones.filter(zone => !configuredZoneNames.includes(zone as any));
  }
}
