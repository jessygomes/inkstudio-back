import { PartialType } from '@nestjs/mapped-types';
import { CreateAppointmentConsumableDto } from './create-appointment-consumable.dto';

export class UpdateAppointmentConsumableDto extends PartialType(CreateAppointmentConsumableDto) {}
