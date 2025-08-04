import { SetMetadata } from '@nestjs/common';

export const SAAS_LIMIT_KEY = 'saas-limit';
export const SaasLimit = (
  action: 'appointment' | 'client' | 'tatoueur' | 'portfolio',
) => SetMetadata(SAAS_LIMIT_KEY, action);
