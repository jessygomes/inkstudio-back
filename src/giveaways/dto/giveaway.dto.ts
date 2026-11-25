import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationArguments,
} from 'class-validator';
import { GiveawayEntryStatus, GiveawayPrizeType, SaasPlan } from '@prisma/client';
import { CriteriaValidationError, parseCriteria } from '../giveaway-criteria';
import { SUPPORTED_TIMEZONES } from '../giveaway-time';

/** Valide un tableau de critères avec la liste blanche de giveaway-criteria.ts. */
export function IsGiveawayCriteria() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isGiveawayCriteria',
      target: object.constructor,
      propertyName,
      validator: {
        validate(value: unknown) {
          try {
            parseCriteria(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          try {
            parseCriteria(args.value);
            return 'Critères invalides.';
          } catch (error) {
            return error instanceof CriteriaValidationError ? `Critères invalides : ${error.message}` : 'Critères invalides.';
          }
        },
      },
    });
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GiveawayPrizeDto {
  @ApiProperty({ enum: GiveawayPrizeType })
  @IsEnum(GiveawayPrizeType)
  type!: GiveawayPrizeType;

  @ApiProperty({ example: 'Abonnement PRO 12 mois' })
  @IsString()
  @Length(2, 120)
  label!: string;

  @ApiPropertyOptional({ enum: ['PRO', 'BUSINESS'] })
  @IsOptional()
  @IsIn([SaasPlan.PRO, SaasPlan.BUSINESS])
  plan?: SaasPlan;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36)
  durationMonths?: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Valeur commerciale unitaire en centimes (à renseigner, jamais devinée).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  commercialValueCents?: number;

  @ApiPropertyOptional({ example: 'EUR' })
  @IsOptional()
  @IsIn(['EUR'])
  currency?: string;
}

export class GiveawayCategoryDto {
  @ApiProperty({ example: 'independent' })
  @IsString()
  @Length(2, 40)
  @Matches(SLUG_PATTERN)
  key!: string;

  @ApiProperty({ example: 'Tatoueur indépendant' })
  @IsString()
  @Length(2, 120)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ description: 'Critères (liste blanche, voir docs/giveaways.md)', type: 'array', items: { type: 'object' } })
  @IsDefined()
  @IsGiveawayCriteria()
  criteria!: unknown;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(100)
  winnersCount!: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  alternatesCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder?: number;

  @ApiProperty({ type: [GiveawayPrizeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GiveawayPrizeDto)
  prizes!: GiveawayPrizeDto[];
}

export class GiveawayConfigDto {
  @ApiPropertyOptional({ description: 'Délai laissé au gagnant pour accepter son lot (jours).', example: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  acceptanceDays?: number;

  @ApiPropertyOptional({ description: 'Conservation des données des non-gagnants après la fin (jours).', example: 365 })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(1825)
  retentionDays?: number;

  @ApiPropertyOptional({ description: 'Visuel de la page publique (URL https).' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'Afficher la valeur commerciale des lots sur la page publique.', example: true })
  @IsOptional()
  @IsBoolean()
  showPrizeValue?: boolean;
}

export class CreateGiveawayDto {
  @ApiProperty({ example: 'inkera-2026-2027' })
  @IsString()
  @Length(3, 80)
  @Matches(SLUG_PATTERN)
  slug!: string;

  @ApiProperty()
  @IsString()
  @Length(3, 160)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiProperty({ example: '2026-12-01T00:00:00+01:00' })
  @IsDateString({ strict: true })
  opensAt!: string;

  @ApiProperty({ example: '2027-01-07T23:59:59.999+01:00' })
  @IsDateString({ strict: true })
  closesAt!: string;

  @ApiProperty({ example: '2027-01-08T10:00:00+01:00' })
  @IsDateString({ strict: true })
  drawAt!: string;

  @ApiPropertyOptional({ enum: SUPPORTED_TIMEZONES })
  @IsOptional()
  @IsIn(SUPPORTED_TIMEZONES as unknown as string[])
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  rulesUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  rulesContent?: string;

  @ApiPropertyOptional({ type: GiveawayConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GiveawayConfigDto)
  config?: GiveawayConfigDto;

  @ApiProperty({ type: [GiveawayCategoryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GiveawayCategoryDto)
  categories!: GiveawayCategoryDto[];
}

/** Modification d'un concours. Les champs substantiels sont refusés une fois le concours ouvert (voir AmendGiveawayDto). */
export class UpdateGiveawayDto {
  /** Modifiable tant que le concours n'a jamais été publié (liens partagés et e-mails ensuite). */
  @IsOptional() @IsString() @Length(3, 80) @Matches(SLUG_PATTERN) slug?: string;
  @IsOptional() @IsString() @Length(3, 160) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @IsOptional() @IsDateString({ strict: true }) opensAt?: string;
  @IsOptional() @IsDateString({ strict: true }) closesAt?: string;
  @IsOptional() @IsDateString({ strict: true }) drawAt?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) rulesUrl?: string;
  @IsOptional() @IsString() @MaxLength(200_000) rulesContent?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => GiveawayConfigDto) config?: GiveawayConfigDto;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => GiveawayCategoryDto)
  categories?: GiveawayCategoryDto[];
}

export class PrizeAmendmentDto {
  @IsString() prizeId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) commercialValueCents?: number;
}

/** Procédure contrôlée après ouverture : motif obligatoire, version de règlement incrémentée, audit avant / après. */
export class AmendGiveawayDto {
  @ApiProperty({ description: 'Motif (consigné dans l’audit)' })
  @IsString() @Length(20, 2000) reason!: string;
  @IsOptional() @IsDateString({ strict: true }) closesAt?: string;
  @IsOptional() @IsDateString({ strict: true }) drawAt?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) rulesUrl?: string;
  @IsOptional() @IsString() @MaxLength(200_000) rulesContent?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PrizeAmendmentDto)
  prizes?: PrizeAmendmentDto[];
  @ApiProperty({ description: 'Le nouveau règlement a été validé juridiquement.' })
  @IsBoolean() @Equals(true) rulesLegallyApproved!: true;
}

export class DuplicateGiveawayDto {
  @IsString() @Length(3, 80) @Matches(SLUG_PATTERN) slug!: string;
  @IsOptional() @IsString() @Length(3, 160) title?: string;
}

export class ConfirmActionDto {
  @ApiProperty({ description: 'Recopier le slug du concours pour confirmer.' })
  @IsString() @Length(3, 80) confirmation!: string;
}

export class ReasonDto {
  @IsString() @Length(10, 2000) reason!: string;
}

export class VoidDrawDto {
  @ApiProperty({ description: 'Motif détaillé (30 caractères minimum).' })
  @IsString() @Length(30, 2000) reason!: string;
  @ApiProperty({ description: '« ANNULER <slug> »' })
  @IsString() confirmation!: string;
}

export class ReviewEntryDto {
  @IsIn([GiveawayEntryStatus.VALID, GiveawayEntryStatus.INVALID]) decision!: 'VALID' | 'INVALID';
  @IsString() @Length(3, 1000) note!: string;
}

export class EntriesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsEnum(GiveawayEntryStatus) status?: GiveawayEntryStatus;
  @IsOptional() @IsString() @Length(1, 60) categoryId?: string;
  @IsOptional() @IsString() @Length(1, 100) search?: string;
}

export class ActivateAwardDto {
  @IsOptional() @IsString() @Length(64, 64) confirmation?: string;
  @IsOptional() @IsString() @Length(36, 36) requestId?: string;
}

export class EnterGiveawayDto {
  @ApiProperty({ description: 'Acceptation explicite du règlement (case non précochée côté front).', example: true })
  @IsBoolean()
  @Equals(true, { message: 'Vous devez accepter le règlement pour participer.' })
  acceptRules!: true;

  @ApiProperty({ description: 'Version du règlement affichée au participant.', example: 1 })
  @IsInt()
  @Min(1)
  rulesVersion!: number;
}

export class AcceptAwardDto {
  @ApiProperty({ description: 'Publication du nom dans les résultats : choix distinct et libre.' })
  @IsBoolean()
  publicationConsent!: boolean;
}

export class PublicationConsentDto {
  @IsBoolean() publicationConsent!: boolean;
}
