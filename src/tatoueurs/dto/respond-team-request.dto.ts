import { IsIn } from 'class-validator';

export class RespondTeamRequestDto {
  @IsIn(['accept', 'refuse'])
  action!: 'accept' | 'refuse';
}
