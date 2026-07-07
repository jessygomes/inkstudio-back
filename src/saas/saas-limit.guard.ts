import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SaasService } from '../saas/saas.service';
import { SAAS_LIMIT_KEY, SaasGuardAction } from './saas-limit.decorator';

@Injectable()
export class SaasLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly saasService: SaasService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Récupérer l'action depuis le décorateur
    const action = this.reflector.get<SaasGuardAction>(
      SAAS_LIMIT_KEY,
      context.getHandler(),
    );

    // Si pas de limite définie, autoriser
    if (!action) {
      return true;
    }

    // Récupérer l'utilisateur depuis la requête
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    if (!userId) {
      return false;
    }

    await this.saasService.enforceSaasAccess(userId, action);
    return true;
  }
}
