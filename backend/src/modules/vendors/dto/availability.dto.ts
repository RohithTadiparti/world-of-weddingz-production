import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_SLOT_CAPACITY,
  MIN_SLOT_CAPACITY,
  SLOT_CAPACITY_MAX_MESSAGE,
  SLOT_CAPACITY_MIN_MESSAGE,
} from '../slot-rules';

/** 24-hour HH:MM. Seconds are not a thing anybody schedules a wedding by. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Use 24-hour HH:MM, for example 18:00';

export class CreateSlotDto {
  @ApiProperty({ format: 'date', example: '2026-09-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '12:00' })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime: string;

  @ApiProperty({ example: '16:00' })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime: string;

  @ApiPropertyOptional({
    minimum: MIN_SLOT_CAPACITY,
    maximum: MAX_SLOT_CAPACITY,
    description:
      'How many bookings this window can take at once, 1 to 20. Defaults to the service’s ' +
      'configured capacity (held at 20) — five for a caterer running five teams, one for a hall.',
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_SLOT_CAPACITY, { message: SLOT_CAPACITY_MIN_MESSAGE })
  @Max(MAX_SLOT_CAPACITY, { message: SLOT_CAPACITY_MAX_MESSAGE })
  capacity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which of the vendor’s services this window is for. Required for a vendor that has a ' +
      'service on sale; publishing per service is what lets one afternoon be five catering ' +
      'bookings and one tasting.',
  })
  @IsOptional()
  @IsUUID()
  vendorServiceId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateSlotDto {
  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime?: string;

  @ApiPropertyOptional({ minimum: MIN_SLOT_CAPACITY, maximum: MAX_SLOT_CAPACITY })
  @IsOptional()
  @IsInt()
  @Min(MIN_SLOT_CAPACITY, { message: SLOT_CAPACITY_MIN_MESSAGE })
  @Max(MAX_SLOT_CAPACITY, { message: SLOT_CAPACITY_MAX_MESSAGE })
  capacity?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class BlockSlotDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Why the window is unavailable — a holiday, a private booking.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  to?: string;

  // Availability is service-specific: a buyer checking a particular service
  // must see only that service's slots (plus any not tied to a service), not
  // every service the vendor sells. Without this a slot published for Transport
  // showed up under Makeup too (EZ1-I28).
  @ApiPropertyOptional({ format: 'uuid', description: 'Only slots for this vendor service' })
  @IsOptional()
  @IsUUID()
  vendorServiceId?: string;
}
