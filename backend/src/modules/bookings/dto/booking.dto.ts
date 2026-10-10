import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { IsStrictNumber } from '../../../common/decorators/strict-type.decorator';
import { BookingStatus, PaymentMethod, PaymentMilestone, ProviderType } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PLANNER_SERVICE_KEYS } from '../../wedding-planners/planner-catalog';
import { WEDDING_TYPES } from '../planner-requests';

/**
 * The structured part of a request to a wedding planner.
 *
 * A planner is hired for the whole wedding, so what they price on is its size
 * and shape: how many guests, what kind of wedding, where and roughly what it
 * may cost. The services go in `requestedServices`, free text in
 * `requirements`, and reference photos in `referenceImages`.
 */
export class PlannerBriefDto {
  @ApiPropertyOptional({ maxLength: 120, example: 'Hyderabad, Telangana' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  guestCountMin?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  guestCountMax?: number;

  @ApiPropertyOptional({ enum: WEDDING_TYPES })
  @IsOptional()
  @IsIn([...WEDDING_TYPES])
  weddingType?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsStrictNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  budgetMin?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsStrictNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  budgetMax?: number;
}

export class CreateBookingDto {
  /**
   * The couple this request is for, when a planner raises it for them.
   *
   * Omitted by a couple booking for themselves, which is every other caller.
   * Supplying it is refused unless the caller holds
   * BOOKING_REQUEST_FOR_CLIENT and is actually engaged on that wedding, so the
   * field grants nothing on its own (EZ1-I235).
   */
  @ApiPropertyOptional({ format: 'uuid', description: "The engaged client's user id." })
  @IsOptional()
  @IsUUID()
  forClientUserId?: string;

  @ApiProperty({ enum: ProviderType, default: ProviderType.VENDOR })
  @IsEnum(ProviderType)
  providerType: ProviderType = ProviderType.VENDOR;

  @ApiProperty({ format: 'uuid', description: 'Vendor id or planner-profile id' })
  @IsUUID('4')
  providerId: string;

  /**
   * Only for a listed-price booking. A vendor request leaves it out — the price
   * is whatever the provider quotes against the requirements below.
   */
  @ApiPropertyOptional({ example: 50000, minimum: 1, maximum: 100_000_000 })
  @IsOptional()
  @IsStrictNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'A booking amount must be greater than zero' })
  @Max(100_000_000)
  amount?: number;

  /** The published window being requested. Required for a vendor booking. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  slotId?: string;

  /** The wedding event this is for — the reception, the mehendi. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  eventId?: string;

  // --------------------------------------------------------------- catalog
  //
  // Which service is being booked, at which published price, and the buyer's
  // answers to that service's booking form. Optional so that a provider who
  // has not moved onto the catalog can still take a request the old way.

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The vendor service being requested. Its booking form decides what is asked.',
  })
  @IsOptional()
  @IsUUID('4')
  vendorServiceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Which published price was chosen.' })
  @IsOptional()
  @IsUUID('4')
  offeringId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Answers to the service’s booking form, validated against the same rows the form was ' +
      'generated from.',
  })
  @IsOptional()
  @IsObject()
  serviceAnswers?: Record<string, unknown>;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Plates, hours, days — whatever the chosen price counts.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  /**
   * What the provider needs to know to price the job: guest count, menu,
   * timings, anything particular. Required by the service only for the trades
   * that cannot quote without it (venue, catering, florist) and only where the
   * service has no booking form of its own; see booking-request-rules.ts.
   */
  @ApiPropertyOptional({ maxLength: 4000, minLength: 10 })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Tell the provider what you need — at least a sentence' })
  @MaxLength(4000)
  requirements?: string;

  /**
   * Designs the buyer has for reference — a mehendi pattern, a stage they liked.
   * Uploaded first through the media presign; only the URLs arrive here.
   */
  @ApiPropertyOptional({ type: [String], maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUploadedUrl({ each: true })
  @MaxLength(2048, { each: true })
  referenceImages?: string[];

  /**
   * The services the couple ticked on a planner's profile, carried onto the
   * request so the planner reads them and the couple does not type them out
   * again. Planner requests only; refused on a vendor request.
   */
  @ApiPropertyOptional({ type: [String], enum: PLANNER_SERVICE_KEYS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLANNER_SERVICE_KEYS.length)
  @ArrayUnique()
  @IsIn(PLANNER_SERVICE_KEYS, { each: true, message: 'Choose services from the list' })
  requestedServices?: string[];

  /**
   * What the buyer hopes to spend. Optional on purpose: the provider quotes
   * against the requirements, and demanding a number from someone who does not
   * have one only produces a fictional one.
   */
  @ApiPropertyOptional({ example: 50000, minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsStrictNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  expectedBudget?: number;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  /**
   * The time of day asked for on a "Request on Date" -- a date with no
   * published window. Only meaningful with `eventDate` and without `slotId`;
   * a published window already says when it runs.
   */
  @ApiPropertyOptional({ example: '18:30', description: 'HH:MM, 24-hour.' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Give the time as HH:MM' })
  requestedTime?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Planner requests only: the wedding's size, type, budget and services. */
  @ApiPropertyOptional({ type: PlannerBriefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlannerBriefDto)
  plannerBrief?: PlannerBriefDto;
}

export class PayDto {
  @ApiPropertyOptional({
    enum: PaymentMilestone,
    default: PaymentMilestone.ADVANCE,
    description: 'Which instalment to pay. They must be paid in order.',
  })
  @IsOptional()
  @IsEnum(PaymentMilestone)
  milestone?: PaymentMilestone;

  /**
   * How it is being paid.
   *
   * Whether a given method is *accepted* is configuration and is checked in the
   * service, not here — a deployment that has not turned on netbanking should
   * refuse it with a sentence about this platform rather than a validation
   * error listing an enum.
   */
  @ApiPropertyOptional({
    enum: PaymentMethod,
    default: PaymentMethod.CARD,
    description:
      'card, upi and netbanking are held in escrow. cash is settled directly between the two parties and is not protected.',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}

/**
 * The provider accepting the customer's own price, said back to the server.
 *
 * The amount is required so a press of "Accept" can only ever agree the figure
 * the provider was shown: if the request moved underneath them, or the client
 * would have fallen back to some other price, the server refuses rather than
 * agreeing a number nobody looked at.
 */
export class AcceptRequestDto {
  @ApiProperty({ example: 20000, minimum: 1, maximum: 100_000_000 })
  @IsStrictNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'Confirm the amount you are accepting' })
  @Max(100_000_000)
  amount: number;
}

export class CancelBookingDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** A message inside a booking. No recipient: a booking has exactly two sides. */
export class BookingMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsUploadedUrl()
  @MaxLength(2048)
  mediaUrl?: string;
}

export class BookingSearchDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
