import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateAftercareDto } from './dto/create-aftercare.dto';
import { UpdateAftercareDto } from './dto/update-aftercare.dto';

@Injectable()
export class AftercareService {
  constructor(private readonly prisma: PrismaService) {}

  //! CREER UN SUIVI POST-TATOUAGE
  async createAftercare(body: CreateAftercareDto) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: body.clientId },
      });

      if (!client) {
        return { error: true, message: 'Client introuvable.' };
      }

      const aftercare = await this.prisma.aftercare.create({
        data: {
          clientId: body.clientId,
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      return { error: true, message };
    }
  }

  //! MODIFIER UN SUIVI POST-TATOUAGE
  async updateAftercare(id: string, dto: UpdateAftercareDto) {
    try {
      const existing = await this.prisma.aftercare.findUnique({
        where: { id },
      });
  
      if (!existing) {
        return {
          error: true,
          message: 'Suivi post-tatouage introuvable.',
        };
      }
  
      const updated = await this.prisma.aftercare.update({
        where: { id },
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
        aftercare: updated,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      return { error: true, message };
    }
  }

  //! SUPPRIMER UN SUIVI POST-TATOUAGE
  async deleteAftercare(id: string) {
    try {
      const deleted = await this.prisma.aftercare.delete({
        where: { id },
      });

      return {
        error: false,
        message: 'Suivi post-tatouage supprimé.',
        aftercare: deleted,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      return { error: true, message };
    }
  }
}
