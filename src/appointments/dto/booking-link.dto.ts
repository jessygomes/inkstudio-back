import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingLinkMode, PrestationType } from '@prisma/client';
import { SkinTone } from '../constants/skin-tone.constants';

export class CreateBookingLinkDto {
  @IsOptional() @IsString() @IsNotEmpty() userId?: string;
  @IsOptional() @IsString() @IsNotEmpty() tatoueurId?: string;
  @IsOptional() @IsString() @IsNotEmpty() venueSalonId?: string;
  @IsIn(['TATTOO', 'RETOUCHE']) prestation: PrestationType;
  @IsInt() @Min(1) @Max(1440) durationMinutes: number;
  @IsEnum(BookingLinkMode) mode: BookingLinkMode;
  @IsOptional() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) fixedStartTime?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) allowedFrom: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) allowedTo: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsString() @IsNotEmpty() clientId?: string;
  @IsOptional() @IsString() @IsNotEmpty() projectAppointmentId?: string;
  @IsOptional() @IsString() @IsNotEmpty() conversationId?: string;
  @IsOptional() @IsString() @IsNotEmpty() inboxThreadId?: string;
}

export class BookingLinkAvailabilityDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}

export class BookingLinkClientDto {
  @IsString() @IsNotEmpty() @MaxLength(100) clientFirstname: string;
  @IsString() @IsNotEmpty() @MaxLength(100) clientLastname: string;
  @IsEmail() @MaxLength(254) clientEmail: string;
  @IsOptional() @IsString() @MaxLength(40) clientPhone?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) clientBirthdate?: string;
  @IsEnum(SkinTone) skin: SkinTone;
}

export class ConfirmBookingLinkDto {
  @IsDateString() @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) start: string;
  @ValidateNested()
  @Type(() => BookingLinkClientDto)
  @IsNotEmpty()
  rdvBody: BookingLinkClientDto;
}

export class ListBookingLinksDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
