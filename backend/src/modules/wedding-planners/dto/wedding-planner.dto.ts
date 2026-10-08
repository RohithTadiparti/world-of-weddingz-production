import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
  buildMessage,
  isURL,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SocialLinksDto } from '../../../common/dto/social-links.dto';
import { IsMediaUrlShape } from '../../../common/decorators/uploaded-url.decorator';
import { isMediaRef } from '../../../platform/storage/storage-keys';
import {
  MAX_PLANNER_WEDDINGS,
  MAX_WEDDING_EVENTS,
  MAX_WEDDING_PHOTOS,
  MAX_WEDDING_VIDEOS,
  PLANNER_SERVICE_KEYS,
  PLANNER_SPECIALIZATION_KEYS,
  VIDEO_HOSTS,
} from '../planner-catalog';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  normaliseMobile,
} from '../../../common/util/identity-fields';
import { ReviewStatus } from '../../../common/enums';

export class PlannerPackageDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ minimum: 0, maximum: 100_000_000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  price: number;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  includes?: string[];
}

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * An uploaded video, or a film on YouTube or Vimeo. Null passes: it clears the
 * field.
 *
 * Shaped like IsUploadedUrl (a storage host may have no TLD), with the
 * protocol limited to http(s) so a `javascript:` link is never stored. Only a
 * YouTube or Vimeo address (VIDEO_HOSTS, matched again by the clients) is ever
 * framed into the page; anything else plays in a plain video element, so
 * accepting other hosts embeds nobody's page.
 */
function IsVideoUrl(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isVideoUrl',
      validator: {
        validate: (value: unknown) =>
          value === null ||
          (typeof value === 'string' &&
            (isMediaRef(value) ||
              isURL(value, { protocols: ['https'], require_protocol: true, host_whitelist: VIDEO_HOSTS }) ||
              isURL(value, { protocols: ['http', 'https'], require_protocol: true, require_tld: false }))),
        defaultMessage: buildMessage(
          (each) => `${each}$property must be an uploaded video or a YouTube or Vimeo link`,
          options,
        ),
      },
    },
    options,
  );
}

export class PlannerWeddingEventDto {
  @ApiProperty({ example: 'Sangeet', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Transform(blankToNull)
  @IsDateString()
  date?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

/** A wedding in the planner's portfolio. Without `id` it is new; the server assigns one. */
export class PlannerWeddingDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Rahul & Priya', maxLength: 120 })
  @IsString()
  @MinLength(2, { message: 'Name each wedding, for example the couple' })
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Transform(blankToNull)
  @IsDateString()
  date?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToNull)
  // A new value must be an upload; the stored one may be resent (kept-media.ts).
  @IsMediaUrlShape()
  @MaxLength(2048)
  coverUrl?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_WEDDING_PHOTOS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WEDDING_PHOTOS)
  // New entries must be uploads; ones already stored may be resent (kept-media.ts).
  @IsMediaUrlShape({ each: true })
  @MaxLength(2048, { each: true })
  photos?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: MAX_WEDDING_VIDEOS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WEDDING_VIDEOS)
  @IsVideoUrl({ each: true })
  @MaxLength(2048, { each: true })
  videos?: string[];

  @ApiPropertyOptional({ type: () => [PlannerWeddingEventDto], maxItems: MAX_WEDDING_EVENTS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WEDDING_EVENTS)
  @ValidateNested({ each: true })
  @Type(() => PlannerWeddingEventDto)
  events?: PlannerWeddingEventDto[];
}

export class UpsertPlannerProfileDto extends SocialLinksDto {
  @ApiProperty({ example: 'Everafter Weddings', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  agencyName: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 25 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  servesCities?: string[];

  @ApiPropertyOptional({ type: [PlannerPackageDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlannerPackageDto)
  packages?: PlannerPackageDto[];

  @ApiPropertyOptional({ minimum: 0, maximum: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(80)
  yearsExperience?: number;

  // Contact and location details, validated field-by-field (EZ1-I69).
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'hello@everafter.example' })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ example: '500001' })
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'Enter a valid 6-digit pincode' })
  pincode?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  // New entries must be uploads; ones already stored may be resent (kept-media.ts).
  @IsMediaUrlShape({ each: true })
  @MaxLength(2048, { each: true })
  portfolio?: string[];

  @ApiPropertyOptional({ type: [String], enum: PLANNER_SERVICE_KEYS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLANNER_SERVICE_KEYS.length)
  @ArrayUnique()
  @IsIn(PLANNER_SERVICE_KEYS, { each: true, message: 'Choose services from the list' })
  services?: string[];

  @ApiPropertyOptional({ type: [String], enum: PLANNER_SPECIALIZATION_KEYS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLANNER_SPECIALIZATION_KEYS.length)
  @ArrayUnique()
  @IsIn(PLANNER_SPECIALIZATION_KEYS, { each: true, message: 'Choose specializations from the list' })
  specializations?: string[];

  @ApiPropertyOptional({ description: 'An uploaded video, or a YouTube or Vimeo link. Blank clears it.' })
  @IsOptional()
  @Transform(blankToNull)
  @IsVideoUrl()
  @MaxLength(2048)
  introVideoUrl?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  weddingsCompleted?: number | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(1000)
  planningApproach?: string | null;

  @ApiPropertyOptional({ type: () => [PlannerWeddingDto], maxItems: MAX_PLANNER_WEDDINGS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLANNER_WEDDINGS)
  @ValidateNested({ each: true })
  @Type(() => PlannerWeddingDto)
  weddings?: PlannerWeddingDto[];
}

export class PlannerSearchDto extends PaginationDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
}

/**
 * A couple's review of the planner who ran their wedding (EZ1-I244).
 *
 * The overall rating is the only required part and the only one the average is
 * computed from. The five category scores are optional and stay optional: a
 * couple who wants to say "five stars, they were excellent" should not have to
 * grade five separate things to say it.
 */
export class CreatePlannerReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ maxLength: 1500 })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  comment?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Planning & coordination' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  planning?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  communication?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  serviceQuality?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  professionalism?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  timeliness?: number;
}

export class AdminPlannerReviewQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  plannerId?: string;

  /** Name, email or the text of the review — one box, as the admin page has. */
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class ModeratePlannerReviewDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  /**
   * Required for anything but publishing, enforced in the service rather than
   * here: whether a reason is needed depends on which status was chosen.
   */
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
