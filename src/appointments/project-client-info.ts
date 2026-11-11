import { BadRequestException } from '@nestjs/common';
import { ProjectClientInfoDto } from './dto/project-client-info.dto';

export const projectClientInfoSelect = {
  projectBudgetMinCents: true, projectBudgetMaxCents: true, isFirstTattoo: true,
} as const;
export const emptyProjectClientInfo = {
  projectBudgetMinCents: null, projectBudgetMaxCents: null, isFirstTattoo: null,
} as const;

/** Budget bounds form one replacement value; first-tattoo is updated independently. */
export function projectClientInfoData(input: ProjectClientInfoDto, prestation: string) {
  if (!Object.keys(projectClientInfoSelect).some(key => input[key] !== undefined)) return {};
  const invalid = () => { throw new BadRequestException({ code: 'INVALID_PROJECT_CLIENT_INFO', message: 'Budget ou indication premier tatouage invalide, ou prestation autre que PROJET.' }); };
  if (prestation !== 'PROJET') invalid();
  const data: ProjectClientInfoDto = {};
  if (input.projectBudgetMinCents !== undefined || input.projectBudgetMaxCents !== undefined) {
    const min = input.projectBudgetMinCents ?? null;
    const max = input.projectBudgetMaxCents ?? null;
    if ([min, max].some(value => value !== null && (!Number.isInteger(value) || value < 0 || value > 2147483647)) || (min !== null && max !== null && min > max)) invalid();
    data.projectBudgetMinCents = min;
    data.projectBudgetMaxCents = max;
  }
  if (input.isFirstTattoo !== undefined) {
    if (input.isFirstTattoo !== null && typeof input.isFirstTattoo !== 'boolean') invalid();
    data.isFirstTattoo = input.isFirstTattoo;
  }
  return data;
}
