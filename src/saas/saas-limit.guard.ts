import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SaasService } from '../saas/saas.service';
import { SAAS_LIMIT_KEY } from './saas-limit.decorator';

@Injectable()
export class SaasLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly saasService: SaasService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Récupérer l'action depuis le décorateur
    const action = this.reflector.get<'appointment' | 'client' | 'tatoueur' | 'portfolio'>(
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

    try {
      // Vérifier si l'action est autorisée (lancer une exception si limite atteinte)
      await this.saasService.enforceLimit(userId, action);
      return true;
    } catch {
      // Si une exception est lancée, l'action n'est pas autorisée
      return false;
    }
  }
}
