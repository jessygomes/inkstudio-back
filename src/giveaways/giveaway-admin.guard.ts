import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Accès admin des concours : en plus du rôle porté par le jeton (RolesGuard),
 * le rôle est relu en base à chaque requête. Un admin rétrogradé perd l'accès
 * immédiatement, sans attendre l'expiration de son jeton.
 */
@Injectable()
export class GiveawayAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { userId?: string; role?: string } }>();
    const userId = req.user?.userId;
    if (!userId || req.user?.role !== 'admin') throw new ForbiddenException('Acces reserve aux administrateurs.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'admin') throw new ForbiddenException('Acces reserve aux administrateurs.');
    return true;
  }
}
