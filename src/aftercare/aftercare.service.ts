import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAftercareDto } from './dto/create-aftercare.dto';
import { UpdateAftercareDto } from './dto/update-aftercare.dto';

@Injectable()
export class AftercareService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOwnedClient(clientId: string, userId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { userId: true },
    });
    if (!client) throw new NotFoundException('Client introuvable.');
    if (!userId || client.userId !== userId)
      throw new ForbiddenException('Accès refusé à ce client.');
  }

  private async requireOwnedAftercare(id: string, userId: string) {
    const record = await this.prisma.aftercare.findUnique({
      where: { id },
      select: { client: { select: { userId: true } } },
    });
    if (!record)
      throw new NotFoundException('Suivi post-tatouage introuvable.');
    if (!userId || record.client.userId !== userId)
      throw new ForbiddenException('Accès refusé à ce suivi.');
  }

  async createAftercare(body: CreateAftercareDto, userId: string) {
    await this.requireOwnedClient(body.clientId, userId);
    const aftercare = await this.prisma.aftercare.create({
      data: {
        client: { connect: { id: body.clientId, userId } },
        photoUrl: body.photoUrl,
        comment: body.comment,
        approved: body.approved ?? false,
        visibleInPortfolio: body.visibleInPortfolio ?? false,
      },
    });
    return {
      error: false,
      message: 'Suivi post-tatouage enregistré.',
      aftercare,
    };
  }

  async updateAftercare(id: string, dto: UpdateAftercareDto, userId: string) {
    await this.requireOwnedAftercare(id, userId);
    const aftercare = await this.prisma.aftercare.update({
      where: { id, client: { userId } },
      data: {
        photoUrl: dto.photoUrl ?? undefined,
        comment: dto.comment ?? undefined,
        approved: dto.approved ?? undefined,
        visibleInPortfolio: dto.visibleInPortfolio ?? undefined,
      },
    });
    return {
      error: false,
      message: 'Suivi post-tatouage mis à jour.',
      aftercare,
    };
  }

  async deleteAftercare(id: string, userId: string) {
    await this.requireOwnedAftercare(id, userId);
    const aftercare = await this.prisma.aftercare.delete({
      where: { id, client: { userId } },
    });
    return {
      error: false,
      message: 'Suivi post-tatouage supprimé.',
      aftercare,
    };
  }
}
