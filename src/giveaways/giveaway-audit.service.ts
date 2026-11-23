import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Db = Pick<PrismaService, 'giveawayAuditLog'> | Prisma.TransactionClient;

export type AuditInput = {
  giveawayId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Jamais d'e-mail, de téléphone ou de contenu personnel : identifiants et compteurs uniquement. */
  data?: Prisma.InputJsonValue;
};

@Injectable()
export class GiveawayAuditService {
  private readonly logger = new Logger('Giveaways');
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, db: Db = this.prisma) {
    await db.giveawayAuditLog.create({
      data: {
        giveawayId: input.giveawayId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        data: input.data ?? {},
      },
    });
    this.logger.log(
      JSON.stringify({ event: `giveaway.${input.action}`, giveawayId: input.giveawayId, actorId: input.actorId, targetId: input.targetId }),
    );
  }
}
