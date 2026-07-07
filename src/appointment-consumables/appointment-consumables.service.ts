import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateAppointmentConsumableDto } from 'src/appointments/dto/create-appointment-consumable.dto';
import { SearchAppointmentConsumablesDto } from 'src/appointments/dto/search-appointment-consumables.dto';
import { UpdateAppointmentConsumableDto } from 'src/appointments/dto/update-appointment-consumable.dto';

@Injectable()
export class AppointmentConsumablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  private async getConsumableAppointmentForUser(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        userId,
      },
      select: {
        id: true,
        prestation: true,
      },
    });

    if (!appointment) {
      return {
        appointment: null,
        error: {
          error: true,
          message: 'Rendez-vous introuvable ou non autorisé.',
        },
      };
    }

    const allowedPrestations = ['TATTOO', 'PIERCING', 'RETOUCHE'];
    if (!allowedPrestations.includes(appointment.prestation)) {
      return {
        appointment: null,
        error: {
          error: true,
          message: 'Les consommables sont disponibles uniquement pour Tattoo, Retouche et Piercing.',
        },
      };
    }

    return {
      appointment,
      error: null,
    };
  }

  async createAppointmentConsumable(
    appointmentId: string,
    userId: string,
    dto: CreateAppointmentConsumableDto,
  ) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const requestedQuantity = dto.quantity ?? 1;
      if (requestedQuantity <= 0) {
        return {
          error: true,
          message: 'La quantité consommée doit être supérieure à 0.',
        };
      }

      const consumable = await this.prisma.$transaction(async (tx) => {
        let stockItemData: {
          id: string;
          category: string | null;
          name: string;
          brand: string | null;
          reference: string | null;
          pigment: string | null;
          lotNumber: string | null;
          expirationDate: Date | null;
          unit: string | null;
          quantity: number;
        } | null = null;

        if (dto.stockItemId) {
          stockItemData = await tx.stockItem.findFirst({
            where: {
              id: dto.stockItemId,
              userId,
            },
            select: {
              id: true,
              category: true,
              name: true,
              brand: true,
              reference: true,
              pigment: true,
              lotNumber: true,
              expirationDate: true,
              unit: true,
              quantity: true,
            },
          });

          if (!stockItemData) {
            throw new Error('Élément de stock introuvable ou non autorisé.');
          }
        }

        return tx.appointmentConsumable.create({
          data: {
            appointmentId,
            userId,
            stockItemId: dto.stockItemId,
            category: dto.category ?? stockItemData?.category,
            productName: dto.productName ?? stockItemData?.name,
            brand: dto.brand ?? stockItemData?.brand ?? undefined,
            reference: dto.reference ?? stockItemData?.reference ?? undefined,
            pigment: dto.pigment ?? stockItemData?.pigment ?? undefined,
            lotNumber: dto.lotNumber ?? stockItemData?.lotNumber ?? undefined,
            expirationDate:
              dto.expirationDate !== undefined
                ? new Date(dto.expirationDate)
                : stockItemData?.expirationDate ?? undefined,
            quantity: dto.quantity ?? requestedQuantity,
            unit: dto.unit ?? stockItemData?.unit,
            notes: dto.notes,
          },
        });
      });

      await this.cacheService.del(`appointment:${appointmentId}`);

      return {
        error: false,
        message: 'Consommable ajouté au rendez-vous.',
        consumable,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async getAppointmentConsumables(appointmentId: string, userId: string) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const consumables = await this.prisma.appointmentConsumable.findMany({
        where: {
          appointmentId,
          userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        error: false,
        consumables,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async searchAppointmentConsumables(userId: string, query: SearchAppointmentConsumablesDto) {
    try {
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = {
        userId,
      };

      if (query.lotNumber?.trim()) {
        where.lotNumber = {
          contains: query.lotNumber.trim(),
          mode: 'insensitive',
        };
      }

      if (query.reference?.trim()) {
        where.reference = {
          contains: query.reference.trim(),
          mode: 'insensitive',
        };
      }

      if (query.expirationDateFrom || query.expirationDateTo) {
        const expirationDateRange: { gte?: Date; lte?: Date } = {};

        if (query.expirationDateFrom) {
          expirationDateRange.gte = new Date(query.expirationDateFrom);
        }

        if (query.expirationDateTo) {
          expirationDateRange.lte = new Date(query.expirationDateTo);
        }

        where.expirationDate = expirationDateRange;
      }

      const [total, consumables] = await this.prisma.$transaction([
        this.prisma.appointmentConsumable.count({ where }),
        this.prisma.appointmentConsumable.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            appointment: {
              select: {
                id: true,
                prestation: true,
                start: true,
                end: true,
              },
            },
          },
        }),
      ]);

      return {
        error: false,
        consumables,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async updateAppointmentConsumable(
    appointmentId: string,
    consumableId: string,
    userId: string,
    dto: UpdateAppointmentConsumableDto,
  ) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const existingConsumable = await this.prisma.appointmentConsumable.findFirst({
        where: {
          id: consumableId,
          appointmentId,
          userId,
        },
        select: { id: true },
      });

      if (!existingConsumable) {
        return {
          error: true,
          message: 'Consommable introuvable pour ce rendez-vous.',
        };
      }

      const consumable = await this.prisma.appointmentConsumable.update({
        where: { id: consumableId },
        data: {
          stockItemId: dto.stockItemId,
          category: dto.category,
          productName: dto.productName,
          brand: dto.brand,
          reference: dto.reference,
          pigment: dto.pigment,
          lotNumber: dto.lotNumber,
          expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : undefined,
          quantity: dto.quantity,
          unit: dto.unit,
          notes: dto.notes,
        },
      });

      await this.cacheService.del(`appointment:${appointmentId}`);

      return {
        error: false,
        message: 'Consommable mis à jour.',
        consumable,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  async deleteAppointmentConsumable(appointmentId: string, consumableId: string, userId: string) {
    try {
      const validation = await this.getConsumableAppointmentForUser(appointmentId, userId);
      if (validation.error) {
        return validation.error;
      }

      const existingConsumable = await this.prisma.appointmentConsumable.findFirst({
        where: {
          id: consumableId,
          appointmentId,
          userId,
        },
        select: { id: true },
      });

      if (!existingConsumable) {
        return {
          error: true,
          message: 'Consommable introuvable pour ce rendez-vous.',
        };
      }

      await this.prisma.appointmentConsumable.delete({
        where: {
          id: consumableId,
        },
      });

      await this.cacheService.del(`appointment:${appointmentId}`);

      return {
        error: false,
        message: 'Consommable supprimé.',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }
}
