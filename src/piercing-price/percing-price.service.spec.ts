/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PiercingPriceService } from './piercing-price.service';
import { PrismaService } from '../database/prisma.service';
import {
  PiercingZone,
  PiercingZoneOreille,
  PiercingZoneVisage,
  PiercingZoneBouche,
  PiercingZoneCorps,
  PiercingZoneMicrodermal,
} from '@prisma/client';

// Mock factory
const createPrismaMock = () => ({
  piercingPrice: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  piercingServicePrice: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
});

// Test data builders
const buildPiercingZone = (overrides?: Partial<any>) => ({
  id: 'zone-1',
  userId: 'salon-1',
  piercingZone: PiercingZone.OREILLE,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  services: [],
  ...overrides,
});

const buildServicePrice = (overrides?: Partial<any>) => ({
  id: 'service-1',
  userId: 'salon-1',
  piercingPriceId: 'zone-1',
  piercingZoneOreille: PiercingZoneOreille.LOBE,
  piercingZoneVisage: null,
  piercingZoneBouche: null,
  piercingZoneCorps: null,
  piercingZoneMicrodermal: null,
  price: 50,
  description: 'Piercing lobe simple',
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('PiercingPriceService', () => {
  let service: PiercingPriceService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PiercingPriceService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<PiercingPriceService>(PiercingPriceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPiercingZone', () => {
    it('should create a new piercing zone', async () => {
      const dto = { piercingZone: PiercingZone.OREILLE, isActive: true };
      const mockZone = buildPiercingZone();

      prisma.piercingPrice.findUnique.mockResolvedValue(null);
      prisma.piercingPrice.create.mockResolvedValue(mockZone);

      const result = await service.createPiercingZone('salon-1', dto);

      expect(result).toEqual(mockZone);
      expect(prisma.piercingPrice.findUnique).toHaveBeenCalledWith({
        where: {
          userId_piercingZone: {
            userId: 'salon-1',
            piercingZone: PiercingZone.OREILLE,
          },
        },
      });
      expect(prisma.piercingPrice.create).toHaveBeenCalledWith({
        data: {
          userId: 'salon-1',
          piercingZone: PiercingZone.OREILLE,
          isActive: true,
        },
        include: {
          services: true,
        },
      });
    });

    it('should throw BadRequestException if zone already exists', async () => {
      const dto = { piercingZone: PiercingZone.OREILLE, isActive: true };
      prisma.piercingPrice.findUnique.mockResolvedValue(buildPiercingZone());

      await expect(service.createPiercingZone('salon-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createPiercingZone('salon-1', dto)).rejects.toThrow(
        'Cette zone de piercing est déjà configurée',
      );
    });

    it('should default isActive to true if not provided', async () => {
      const dto = { piercingZone: PiercingZone.VISAGE };
      prisma.piercingPrice.findUnique.mockResolvedValue(null);
      prisma.piercingPrice.create.mockResolvedValue(
        buildPiercingZone({ piercingZone: PiercingZone.VISAGE }),
      );

      await service.createPiercingZone('salon-1', dto);

      const createCall = prisma.piercingPrice.create.mock.calls[0]?.[0] as
        | { data?: { isActive?: boolean } }
        | undefined;
      expect(createCall?.data?.isActive).toBe(true);
    });
  });

  describe('getPiercingZones', () => {
    it('should return all piercing zones for a salon', async () => {
      const mockZones = [
        buildPiercingZone({ id: 'zone-1', piercingZone: PiercingZone.OREILLE }),
        buildPiercingZone({ id: 'zone-2', piercingZone: PiercingZone.VISAGE }),
      ];
      prisma.piercingPrice.findMany.mockResolvedValue(mockZones);

      const result = await service.getPiercingZones('salon-1');

      expect(result).toEqual(mockZones);
      expect(prisma.piercingPrice.findMany).toHaveBeenCalledWith({
        where: { userId: 'salon-1' },
        include: {
          services: true,
        },
      });
    });

    it('should return empty array if no zones configured', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([]);

      const result = await service.getPiercingZones('salon-1');

      expect(result).toEqual([]);
    });
  });

  describe('updatePiercingZone', () => {
    it('should update a piercing zone', async () => {
      const updateDto = { isActive: false };
      const mockZone = buildPiercingZone();
      const updatedZone = buildPiercingZone({ isActive: false });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingPrice.update.mockResolvedValue(updatedZone);

      const result = await service.updatePiercingZone(
        'salon-1',
        'zone-1',
        updateDto,
      );

      expect(result).toEqual(updatedZone);
      expect(prisma.piercingPrice.findFirst).toHaveBeenCalledWith({
        where: { id: 'zone-1', userId: 'salon-1' },
      });
      expect(prisma.piercingPrice.update).toHaveBeenCalledWith({
        where: { id: 'zone-1' },
        data: updateDto,
        include: {
          services: true,
        },
      });
    });

    it('should throw NotFoundException if zone not found', async () => {
      prisma.piercingPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePiercingZone('salon-1', 'zone-1', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updatePiercingZone('salon-1', 'zone-1', { isActive: false }),
      ).rejects.toThrow('Zone de piercing non trouvée');
    });

    it('should throw NotFoundException if zone belongs to different salon', async () => {
      prisma.piercingPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePiercingZone('salon-2', 'zone-1', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deletePiercingZone', () => {
    it('should delete a piercing zone', async () => {
      const mockZone = buildPiercingZone();
      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingPrice.delete.mockResolvedValue(mockZone);

      const result = await service.deletePiercingZone('salon-1', 'zone-1');

      expect(result).toEqual(mockZone);
      expect(prisma.piercingPrice.delete).toHaveBeenCalledWith({
        where: { id: 'zone-1' },
      });
    });

    it('should throw NotFoundException if zone not found', async () => {
      prisma.piercingPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.deletePiercingZone('salon-1', 'zone-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deletePiercingZone('salon-1', 'zone-1'),
      ).rejects.toThrow('Zone de piercing non trouvée');
    });
  });

  describe('createServicePrice', () => {
    it('should create a service price with valid data', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneOreille: PiercingZoneOreille.LOBE,
        price: 50,
        description: 'Piercing lobe simple',
        isActive: true,
      };
      const mockZone = buildPiercingZone();
      const mockService = buildServicePrice({
        piercingPrice: mockZone,
      });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create.mockResolvedValue(mockService);

      const result = await service.createServicePrice('salon-1', dto);

      expect(result).toEqual(mockService);
      expect(prisma.piercingServicePrice.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          userId: 'salon-1',
        },
        include: {
          piercingPrice: true,
        },
      });
    });

    it('should throw NotFoundException if piercing zone not found', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneOreille: PiercingZoneOreille.LOBE,
        price: 50,
      };
      prisma.piercingPrice.findFirst.mockResolvedValue(null);

      await expect(service.createServicePrice('salon-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.createServicePrice('salon-1', dto)).rejects.toThrow(
        'Zone de piercing non trouvée',
      );
    });

    it('should throw BadRequestException if no specific zone defined', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        price: 50,
      };
      const mockZone = buildPiercingZone();
      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);

      await expect(service.createServicePrice('salon-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createServicePrice('salon-1', dto)).rejects.toThrow(
        'Vous devez spécifier au moins une zone spécifique',
      );
    });

    it('should accept piercingZoneVisage as specific zone', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneVisage: PiercingZoneVisage.NOSTRIL_CLASSIQUE,
        price: 60,
      };
      const mockZone = buildPiercingZone({ piercingZone: PiercingZone.VISAGE });
      const mockService = buildServicePrice({
        piercingZoneOreille: null,
        piercingZoneVisage: PiercingZoneVisage.NOSTRIL_CLASSIQUE,
        price: 60,
      });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create.mockResolvedValue(mockService);

      const result = await service.createServicePrice('salon-1', dto);

      expect(result).toEqual(mockService);
    });

    it('should accept piercingZoneBouche as specific zone', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneBouche: PiercingZoneBouche.LABRET,
        price: 70,
      };
      const mockZone = buildPiercingZone({ piercingZone: PiercingZone.BOUCHE });
      const mockService = buildServicePrice({
        piercingZoneOreille: null,
        piercingZoneBouche: PiercingZoneBouche.LABRET,
        price: 70,
      });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create.mockResolvedValue(mockService);

      const result = await service.createServicePrice('salon-1', dto);

      expect(result).toEqual(mockService);
    });

    it('should accept piercingZoneCorps as specific zone', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneCorps: PiercingZoneCorps.NOMBRIL,
        price: 80,
      };
      const mockZone = buildPiercingZone({ piercingZone: PiercingZone.CORPS });
      const mockService = buildServicePrice({
        piercingZoneOreille: null,
        piercingZoneCorps: PiercingZoneCorps.NOMBRIL,
        price: 80,
      });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create.mockResolvedValue(mockService);

      const result = await service.createServicePrice('salon-1', dto);

      expect(result).toEqual(mockService);
    });

    it('should accept piercingZoneMicrodermal as specific zone', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneMicrodermal: PiercingZoneMicrodermal.MICRODERMAL,
        price: 100,
      };
      const mockZone = buildPiercingZone({
        piercingZone: PiercingZone.MICRODERMAL,
      });
      const mockService = buildServicePrice({
        piercingZoneOreille: null,
        piercingZoneMicrodermal: PiercingZoneMicrodermal.MICRODERMAL,
        price: 100,
      });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create.mockResolvedValue(mockService);

      const result = await service.createServicePrice('salon-1', dto);

      expect(result).toEqual(mockService);
    });
  });

  describe('getServicePrices', () => {
    it('should return all service prices for a salon', async () => {
      const mockServices = [
        buildServicePrice({ id: 'service-1', price: 50 }),
        buildServicePrice({ id: 'service-2', price: 60 }),
      ];
      prisma.piercingServicePrice.findMany.mockResolvedValue(mockServices);

      const result = await service.getServicePrices('salon-1');

      expect(result).toEqual(mockServices);
      expect(prisma.piercingServicePrice.findMany).toHaveBeenCalledWith({
        where: { userId: 'salon-1' },
        include: {
          piercingPrice: true,
        },
      });
    });

    it('should filter by piercingPriceId if provided', async () => {
      const mockServices = [buildServicePrice()];
      prisma.piercingServicePrice.findMany.mockResolvedValue(mockServices);

      const result = await service.getServicePrices('salon-1', 'zone-1');

      expect(result).toEqual(mockServices);
      expect(prisma.piercingServicePrice.findMany).toHaveBeenCalledWith({
        where: { userId: 'salon-1', piercingPriceId: 'zone-1' },
        include: {
          piercingPrice: true,
        },
      });
    });

    it('should return empty array if no services configured', async () => {
      prisma.piercingServicePrice.findMany.mockResolvedValue([]);

      const result = await service.getServicePrices('salon-1');

      expect(result).toEqual([]);
    });
  });

  describe('updateServicePrice', () => {
    it('should update a service price', async () => {
      const updateDto = { price: 55, description: 'Updated description' };
      const mockService = buildServicePrice();
      const updatedService = buildServicePrice({
        price: 55,
        description: 'Updated description',
      });

      prisma.piercingServicePrice.findFirst.mockResolvedValue(mockService);
      prisma.piercingServicePrice.update.mockResolvedValue(updatedService);

      const result = await service.updateServicePrice(
        'salon-1',
        'service-1',
        updateDto,
      );

      expect(result).toEqual(updatedService);
      expect(prisma.piercingServicePrice.update).toHaveBeenCalledWith({
        where: { id: 'service-1' },
        data: updateDto,
        include: {
          piercingPrice: true,
        },
      });
    });

    it('should throw NotFoundException if service not found', async () => {
      prisma.piercingServicePrice.findFirst.mockResolvedValue(null);

      await expect(
        service.updateServicePrice('salon-1', 'service-1', { price: 55 }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateServicePrice('salon-1', 'service-1', { price: 55 }),
      ).rejects.toThrow('Prix de service non trouvé');
    });
  });

  describe('deleteServicePrice', () => {
    it('should delete a service price', async () => {
      const mockService = buildServicePrice();
      prisma.piercingServicePrice.findFirst.mockResolvedValue(mockService);
      prisma.piercingServicePrice.delete.mockResolvedValue(mockService);

      const result = await service.deleteServicePrice('salon-1', 'service-1');

      expect(result).toEqual(mockService);
      expect(prisma.piercingServicePrice.delete).toHaveBeenCalledWith({
        where: { id: 'service-1' },
      });
    });

    it('should throw NotFoundException if service not found', async () => {
      prisma.piercingServicePrice.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteServicePrice('salon-1', 'service-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteServicePrice('salon-1', 'service-1'),
      ).rejects.toThrow('Prix de service non trouvé');
    });
  });

  describe('getServicePriceById', () => {
    it('should return a service price by id', async () => {
      const mockService = buildServicePrice({
        piercingPrice: buildPiercingZone(),
      });
      prisma.piercingServicePrice.findFirst.mockResolvedValue(mockService);

      const result = await service.getServicePriceById('salon-1', 'service-1');

      expect(result).toEqual(mockService);
      expect(prisma.piercingServicePrice.findFirst).toHaveBeenCalledWith({
        where: { id: 'service-1', userId: 'salon-1' },
        include: {
          piercingPrice: true,
        },
      });
    });

    it('should throw NotFoundException if service not found', async () => {
      prisma.piercingServicePrice.findFirst.mockResolvedValue(null);

      await expect(
        service.getServicePriceById('salon-1', 'service-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getServicePriceById('salon-1', 'service-1'),
      ).rejects.toThrow('Prix de service non trouvé');
    });
  });

  describe('getSalonPricingOverview', () => {
    it('should return formatted overview of zones and services', async () => {
      const mockZones = [
        buildPiercingZone({
          id: 'zone-1',
          piercingZone: PiercingZone.OREILLE,
          services: [
            buildServicePrice({
              id: 'service-1',
              piercingZoneOreille: PiercingZoneOreille.LOBE,
              price: 50,
              description: 'Lobe simple',
            }),
            buildServicePrice({
              id: 'service-2',
              piercingZoneOreille: PiercingZoneOreille.HELIX,
              price: 60,
              description: 'Helix',
            }),
          ],
        }),
        buildPiercingZone({
          id: 'zone-2',
          piercingZone: PiercingZone.VISAGE,
          services: [],
        }),
      ];
      prisma.piercingPrice.findMany.mockResolvedValue(mockZones);

      const result = await service.getSalonPricingOverview('salon-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'zone-1',
        piercingZone: PiercingZone.OREILLE,
        isActive: true,
        servicesCount: 2,
        services: [
          {
            id: 'service-1',
            specificZone: true,
            price: 50,
            description: 'Lobe simple',
          },
          {
            id: 'service-2',
            specificZone: true,
            price: 60,
            description: 'Helix',
          },
        ],
      });
      expect(result[1]).toEqual({
        id: 'zone-2',
        piercingZone: PiercingZone.VISAGE,
        isActive: true,
        servicesCount: 0,
        services: [],
      });
    });

    it('should only include active zones and services', async () => {
      const mockZones = [
        buildPiercingZone({
          isActive: true,
          services: [buildServicePrice({ isActive: true })],
        }),
      ];
      prisma.piercingPrice.findMany.mockResolvedValue(mockZones);

      await service.getSalonPricingOverview('salon-1');

      const findManyCall = prisma.piercingPrice.findMany.mock.calls[0]?.[0] as
        | {
            where?: { userId?: string, isActive?: boolean },
            include?: { services?: { where?: { isActive?: boolean } } },
          }
        | undefined;

      expect(findManyCall?.where?.isActive).toBe(true);
      expect(findManyCall?.include?.services?.where?.isActive).toBe(true);
    });

    it('should detect specificZone correctly for different zone types', async () => {
      const mockZones = [
        buildPiercingZone({
          services: [
            buildServicePrice({
              id: 's1',
              piercingZoneOreille: PiercingZoneOreille.LOBE,
              piercingZoneVisage: null,
              piercingZoneBouche: null,
              piercingZoneCorps: null,
              piercingZoneMicrodermal: null,
            }),
            buildServicePrice({
              id: 's2',
              piercingZoneOreille: null,
              piercingZoneVisage: PiercingZoneVisage.NOSTRIL_CLASSIQUE,
              piercingZoneBouche: null,
              piercingZoneCorps: null,
              piercingZoneMicrodermal: null,
            }),
            buildServicePrice({
              id: 's3',
              piercingZoneOreille: null,
              piercingZoneVisage: null,
              piercingZoneBouche: null,
              piercingZoneCorps: null,
              piercingZoneMicrodermal: PiercingZoneMicrodermal.MICRODERMAL,
            }),
          ],
        }),
      ];
      prisma.piercingPrice.findMany.mockResolvedValue(mockZones);

      const result = await service.getSalonPricingOverview('salon-1');

      expect(result[0].services[0].specificZone).toBe(true);
      expect(result[0].services[1].specificZone).toBe(true);
      expect(result[0].services[2].specificZone).toBe(true);
    });
  });

  describe('getSalonPiercingConfiguration', () => {
    it('should return complete configuration with all details', async () => {
      const serviceDate1 = new Date('2026-01-01');
      const serviceDate2 = new Date('2026-01-02');
      const mockService = buildServicePrice({
        id: 'service-1',
        piercingZoneOreille: PiercingZoneOreille.LOBE,
        price: 50,
        createdAt: serviceDate1,
        updatedAt: serviceDate2,
      });

      const zoneDate1 = new Date('2026-01-01');
      const zoneDate2 = new Date('2026-01-02');
      const mockZones = [
        buildPiercingZone({
          id: 'zone-1',
          piercingZone: PiercingZone.OREILLE,
          createdAt: zoneDate1,
          updatedAt: zoneDate2,
          services: [mockService],
        }),
      ];
      prisma.piercingPrice.findMany.mockResolvedValue(mockZones);

      const result = await service.getSalonPiercingConfiguration('salon-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'zone-1',
        piercingZone: PiercingZone.OREILLE,
        isActive: true,
        createdAt: zoneDate1,
        updatedAt: zoneDate2,
        services: [
          {
            id: 'service-1',
            piercingZoneOreille: PiercingZoneOreille.LOBE,
            piercingZoneVisage: null,
            piercingZoneBouche: null,
            piercingZoneCorps: null,
            piercingZoneMicrodermal: null,
            price: 50,
            description: 'Piercing lobe simple',
            isActive: true,
            createdAt: serviceDate1,
            updatedAt: serviceDate2,
          },
        ],
      });
    });

    it('should include all zones regardless of isActive status', async () => {
      const mockZones = [
        buildPiercingZone({ id: 'zone-1', isActive: true }),
        buildPiercingZone({ id: 'zone-2', isActive: false }),
      ];
      prisma.piercingPrice.findMany.mockResolvedValue(mockZones);

      const result = await service.getSalonPiercingConfiguration('salon-1');

      expect(result).toHaveLength(2);
    });

    it('should order zones by piercingZone alphabetically', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([]);

      await service.getSalonPiercingConfiguration('salon-1');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const [[findManyCall]] = prisma.piercingPrice.findMany.mock.calls as any;

      expect(findManyCall.orderBy).toEqual({ piercingZone: 'asc' });
    });

    it('should order services by price ascending', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([]);

      await service.getSalonPiercingConfiguration('salon-1');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const [[findManyCall]] = prisma.piercingPrice.findMany.mock.calls as any;

      expect(findManyCall.include?.services?.orderBy).toEqual({
        price: 'asc',
      });
    });
  });

  describe('getAvailableZonesForConfiguration', () => {
    it('should return zones not yet configured', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([
        buildPiercingZone({ piercingZone: PiercingZone.OREILLE }),
        buildPiercingZone({ piercingZone: PiercingZone.VISAGE }),
      ]);

      const result = await service.getAvailableZonesForConfiguration('salon-1');

      expect(result).toEqual(['BOUCHE', 'CORPS', 'MICRODERMAL', 'AUTRE']);
    });

    it('should return all zones if none configured', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([]);

      const result = await service.getAvailableZonesForConfiguration('salon-1');

      expect(result).toEqual([
        'OREILLE',
        'VISAGE',
        'BOUCHE',
        'CORPS',
        'MICRODERMAL',
        'AUTRE',
      ]);
    });

    it('should return empty array if all zones configured', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([
        buildPiercingZone({ piercingZone: PiercingZone.OREILLE }),
        buildPiercingZone({ piercingZone: PiercingZone.VISAGE }),
        buildPiercingZone({ piercingZone: PiercingZone.BOUCHE }),
        buildPiercingZone({ piercingZone: PiercingZone.CORPS }),
        buildPiercingZone({ piercingZone: PiercingZone.MICRODERMAL }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        buildPiercingZone({ piercingZone: 'AUTRE' as any }),
      ]);

      const result = await service.getAvailableZonesForConfiguration('salon-1');

      expect(result).toEqual([]);
    });

    it('should only query piercingZone field', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([]);

      await service.getAvailableZonesForConfiguration('salon-1');

      expect(prisma.piercingPrice.findMany).toHaveBeenCalledWith({
        where: { userId: 'salon-1' },
        select: { piercingZone: true },
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle multiple services in same zone', async () => {
      const dto1 = {
        piercingPriceId: 'zone-1',
        piercingZoneOreille: PiercingZoneOreille.LOBE,
        price: 50,
      };
      const dto2 = {
        piercingPriceId: 'zone-1',
        piercingZoneOreille: PiercingZoneOreille.HELIX,
        price: 60,
      };
      const mockZone = buildPiercingZone();

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create
        .mockResolvedValueOnce(buildServicePrice({ id: 'service-1' }))
        .mockResolvedValueOnce(buildServicePrice({ id: 'service-2' }));

      const result1 = await service.createServicePrice('salon-1', dto1);
      const result2 = await service.createServicePrice('salon-1', dto2);

      expect(result1.id).toBe('service-1');
      expect(result2.id).toBe('service-2');
    });

    it('should handle price updates to 0', async () => {
      const updateDto = { price: 0 };
      const mockService = buildServicePrice();
      const updatedService = buildServicePrice({ price: 0 });

      prisma.piercingServicePrice.findFirst.mockResolvedValue(mockService);
      prisma.piercingServicePrice.update.mockResolvedValue(updatedService);

      const result = await service.updateServicePrice(
        'salon-1',
        'service-1',
        updateDto,
      );

      expect(result.price).toBe(0);
    });

    it('should handle empty description', async () => {
      const dto = {
        piercingPriceId: 'zone-1',
        piercingZoneOreille: PiercingZoneOreille.LOBE,
        price: 50,
        description: '',
      };
      const mockZone = buildPiercingZone();
      const mockService = buildServicePrice({ description: '' });

      prisma.piercingPrice.findFirst.mockResolvedValue(mockZone);
      prisma.piercingServicePrice.create.mockResolvedValue(mockService);

      const result = await service.createServicePrice('salon-1', dto);

      expect(result.description).toBe('');
    });

    it('should handle salon with no configurations at all', async () => {
      prisma.piercingPrice.findMany.mockResolvedValue([]);
      prisma.piercingServicePrice.findMany.mockResolvedValue([]);

      const zones = await service.getPiercingZones('salon-1');
      const services = await service.getServicePrices('salon-1');
      const overview = await service.getSalonPricingOverview('salon-1');
      const config = await service.getSalonPiercingConfiguration('salon-1');

      expect(zones).toEqual([]);
      expect(services).toEqual([]);
      expect(overview).toEqual([]);
      expect(config).toEqual([]);
    });
  });
});
