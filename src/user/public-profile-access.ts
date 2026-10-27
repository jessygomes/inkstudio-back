import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Module,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PrismaModule } from '../database/prisma.module';
import { PrismaService } from '../database/prisma.service';

type Target = {
  key: string;
  resource: 'user' | 'tatoueur';
  source: 'params' | 'query' | 'body';
};
const KEY = 'public-profile-access';
export const PublicProfile = (
  key = 'userId',
  resource: Target['resource'] = 'user',
  source: Target['source'] = 'params',
) => SetMetadata(KEY, { key, resource, source });
export const PublicProfiles = (...targets: Target[]) =>
  SetMetadata(KEY, targets);

@Injectable()
export class PublicProfileAccessGuard
  extends AuthGuard('jwt')
  implements CanActivate
{
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    return user;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.get<Target | Target[]>(
      KEY,
      context.getHandler(),
    );
    if (!metadata) return true;
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<{
      params: Record<string, string>;
      query: Record<string, string>;
      body: Record<string, string>;
      user?: { userId: string; role: string };
    }>();
    for (const target of Array.isArray(metadata) ? metadata : [metadata]) {
      const id = target.key
        .split('.')
        .reduce<unknown>(
          (value, segment) =>
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)[segment]
              : undefined,
          req[target.source],
        );
      if (!id) continue; // Optional parameter; the endpoint validates its own input.
      if (typeof id !== 'string')
        throw new NotFoundException('Profil introuvable.');
      const normalizedId = id.startsWith('linked_') ? id.slice(7) : id;
      const userId =
        target.resource === 'tatoueur'
          ? ((
              await this.prisma.tatoueur.findUnique({
                where: { id: normalizedId },
                select: { userId: true },
              })
            )?.userId ?? normalizedId)
          : id;
      if (!userId) throw new NotFoundException('Profil introuvable.');
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { publicVisibility: true },
      });
      if (
        !user ||
        (user.publicVisibility === 'HIDDEN' &&
          req.user?.userId !== userId &&
          req.user?.role !== 'admin')
      ) {
        throw new NotFoundException('Profil introuvable.');
      }
    }
    return true;
  }
}

@Module({
  imports: [PrismaModule],
  providers: [{ provide: APP_GUARD, useClass: PublicProfileAccessGuard }],
})
export class PublicProfileAccessModule {}
