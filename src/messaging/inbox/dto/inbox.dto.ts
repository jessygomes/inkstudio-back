import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { InboxChannel, InboxThreadStatus } from '@prisma/client';
import { MessageAttachmentDto } from '../../messages/dto/create-message.dto';

export class ListInboxThreadsDto {
  @IsEnum(InboxChannel) @IsOptional() channel?: InboxChannel;
  @IsEnum(InboxThreadStatus) @IsOptional() status?: InboxThreadStatus;
  @IsString() @IsOptional() assignedUserId?: string;
  @IsString() @IsOptional() assignedTatoueurId?: string;
  @IsString() @IsOptional() linkedClientId?: string;
  @IsString() @IsOptional() @MaxLength(150) search?: string;
  @IsBoolean() @IsOptional() @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }) unreadOnly?: boolean;
  @IsInt() @Min(1) @IsOptional() @Type(() => Number) page?: number;
  @IsInt() @Min(1) @Max(100) @IsOptional() @Type(() => Number) limit?: number;
}

export class UpdateInboxStatusDto {
  @IsEnum(InboxThreadStatus) status: InboxThreadStatus;
}

export class AssignInboxThreadDto {
  @IsString() @IsOptional() assignedUserId?: string;
  @IsString() @IsOptional() assignedTatoueurId?: string;
}

export class InboxMemberPermissionDto {
  @IsBoolean() canView: boolean;
  @IsBoolean() canReply: boolean;
  @IsBoolean() canAssign: boolean;
}

export class LinkInboxClientDto {
  @IsString() @IsNotEmpty() clientId: string;
}

export class CreateInboxClientDto {
  @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(40) phone: string;
}

export class LinkInboxAppointmentDto {
  @IsString() @IsNotEmpty() appointmentId: string;
}

export class AddInboxNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(5000) content: string;
}

export class InboxReadStateDto {
  @IsBoolean() forceUnread: boolean;
}

export class InboxReplyDto {
  @IsString() @IsNotEmpty() @MaxLength(20000) content: string;
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => MessageAttachmentDto) @IsOptional()
  attachments?: MessageAttachmentDto[];
}

export class SaveInboxReplyDto {
  @IsString() @IsNotEmpty() @MaxLength(100) title: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) content: string;
  @IsEnum(InboxChannel) @IsOptional() channel?: InboxChannel;
}
