import { SetMetadata } from '@nestjs/common';

export const SAAS_LIMIT_KEY = 'saas-limit';
export type SaasGuardAction =
  | 'appointment'
  | 'client'
  | 'stock'
  | 'tatoueur'
  | 'portfolio'
  | 'dashboard';

export const SaasLimit = (action: SaasGuardAction) =>
  SetMetadata(SAAS_LIMIT_KEY, action);
