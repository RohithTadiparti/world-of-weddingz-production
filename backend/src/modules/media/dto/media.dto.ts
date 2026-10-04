import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { IsStrictString } from '../../../common/decorators/strict-type.decorator';
import { MediaType } from '../../../common/enums';

export class CreateAlbumDto {
  @ApiProperty({ minLength: 1, maxLength: 150 })
  @IsStrictString() @MinLength(1) @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * The extensions a browser will actually render, plus the ones phones produce.
 *
 * `jfif` is not a curiosity: Chrome on Windows saves ordinary JPEGs under it,
 * so a photograph downloaded and re-uploaded arrives with that extension
 * through no choice of the person doing it. `avif` and `heic` are what recent
 * phones write by default.
 */
export const UPLOAD_IMAGE_EXTENSIONS =
  'jpg|jpeg|jpe|jfif|pjpeg|png|apng|webp|gif|bmp|avif|heic|heif|tif|tiff';
export const UPLOAD_VIDEO_EXTENSIONS = 'mp4|m4v|mov|webm|3gp';

/**
 * Any filename a real device produces, judged on its extension alone.
 *
 * The previous pattern also demanded `^[A-Za-z0-9._-]+$` for the name, which is
 * the rule that produced "it is not taking all types of images". It was not the
 * type it objected to — it was the name. `WhatsApp Image 2026-08-26 at 5.28.11
 * PM.jpeg` has spaces. `pic (1).png` is what Windows calls the second copy of
 * anything. Both are jpeg and png, and both were refused, so the message the
 * uploader saw was about images when the objection was about punctuation.
 *
 * The name is not the security boundary and never was: the storage key is built
 * server-side, the base name is sanitised into it, and the mock storage
 * controller re-resolves the path against its root regardless. Validating the
 * user's filename bought nothing and cost every upload with a space in it.
 */
/**
 * The name part, kept raw so the regex engine sees the escapes rather than
 * the template literal eating them. Path separators and control characters
 * are the only things excluded, and only so a name cannot look like a path
 * at a glance; the key is still built server-side, and the storage
 * controller still resolves it against its own root before writing a byte.
 */
const NAME_PART = String.raw`[^\\/\x00-\x1f]{1,200}`;

const FILENAME = new RegExp(
  `^${NAME_PART}\\.(${UPLOAD_IMAGE_EXTENSIONS}|${UPLOAD_VIDEO_EXTENSIONS})$`,
  'i',
);

/**
 * What a client knows about the file before it uploads it.
 *
 * Optional, so every client written before these existed keeps working on the
 * local store. When given, both are signed into the upload slot and the store
 * refuses a file that differs; on a private (S3) store the size is required,
 * because a slot with no length signed into it accepts anything up to 5 GB.
 */
export class UploadDetailsDto {
  @ApiPropertyOptional({ description: 'The exact size of the file in bytes.', example: 482133 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024 * 1024)
  size?: number;

  @ApiPropertyOptional({
    description: 'The type the file will be uploaded with. Must be sent as Content-Type on the PUT.',
    example: 'image/jpeg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z]+\/[a-z0-9.+-]+$/i, { message: 'contentType must be a MIME type such as image/jpeg' })
  contentType?: string;
}

export class PresignDto extends UploadDetailsDto {
  /**
   * Where the photograph is going. `portfolio` files it under the caller's own
   * vendor listing (vendors/{vendorId}/portfolio/…); anything else under their
   * profile (users/{userId}/profile/…).
   */
  @ApiPropertyOptional({ enum: ['profile', 'portfolio'], default: 'profile' })
  @IsOptional()
  @IsIn(['profile', 'portfolio'])
  purpose?: 'profile' | 'portfolio';

  @ApiProperty({ example: 'holiday photo (1).jpeg', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(FILENAME, {
    message:
      'Choose an image or video file. Accepted: JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, TIFF, MP4, MOV, WebM.',
  })
  filename: string;
}

/**
 * An upload slot for evidence: a receipt, an invoice, a screenshot.
 *
 * A separate class from `PresignDto` rather than a widened one, because the two
 * are answering different questions. A profile photograph must be an image —
 * accepting a PDF there produces a biodata that renders as a broken box. A
 * support attachment is whatever proves the point, and in practice that is as
 * often an invoice as a photograph. The album route stays image-and-video only.
 */
export class PresignAttachmentDto extends UploadDetailsDto {
  @ApiProperty({ example: 'invoice april 2026.pdf', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(new RegExp(`^${NAME_PART}\\.(${UPLOAD_IMAGE_EXTENSIONS}|pdf)$`, 'i'), {
    message: 'Choose an image or a PDF.',
  })
  filename: string;
}

/**
 * The document types the browser-side biodata importer supports. Image files
 * remain available to the separate vision-reader endpoint; PDF, Word and
 * spreadsheet files are extracted locally in the form and are stored only as
 * the biodata source document.
 */
export const BIODATA_IMAGE_EXTENSIONS = 'jpg|jpeg|png|webp';
export const BIODATA_DOCUMENT_EXTENSIONS = `${BIODATA_IMAGE_EXTENSIONS}|pdf|docx|xlsx|xls|csv`;

export class PresignBiodataDto extends UploadDetailsDto {
  @ApiProperty({ example: 'my biodata.jpg', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(new RegExp(`^${NAME_PART}\\.(${BIODATA_DOCUMENT_EXTENSIONS})$`, 'i'), {
    message: 'Choose a biodata PDF, Word or Excel file, or a JPEG, PNG or WebP image.',
  })
  filename: string;
}

/**
 * A file on a booking: what the provider delivers, or what the couple shows
 * them. Photographs and films, and a PDF for an album proof or a contract.
 */
export class PresignBookingFileDto extends UploadDetailsDto {
  @ApiProperty({ example: 'sangeet-0412.jpg', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(
    new RegExp(`^${NAME_PART}\\.(${UPLOAD_IMAGE_EXTENSIONS}|${UPLOAD_VIDEO_EXTENSIONS}|pdf)$`, 'i'),
    { message: 'Choose an image, a video or a PDF.' },
  )
  filename: string;
}

/** The upload slot a client has just finished writing to. */
export class CompleteUploadDto {
  @ApiProperty({ example: 'users/5b1d…/profile/1767000000000-3f2a…-photo.jpg', maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  @Matches(/^[A-Za-z0-9._\-/]+$/, { message: 'key must be the key the upload slot was issued for' })
  key: string;

  /**
   * What the file is about to become. `profile_photo` has it checked for
   * AI generation here, so a refused photograph is refused (and deleted)
   * before the screen shows it as added. The profile-photo slot is also used
   * for invitation cards and listing pictures, which is why the area alone
   * does not decide it — and why the attach points check again regardless.
   */
  @ApiPropertyOptional({ enum: ['profile_photo'] })
  @IsOptional()
  @IsIn(['profile_photo'])
  purpose?: 'profile_photo';
}

/** A stored reference to open: `media://…` as stored, or the bare key. */
export class SignMediaDto {
  @ApiProperty({ example: 'media://bookings/9c0e…/deliveries/1767000000000-ab12…-sangeet.jpg' })
  @IsString()
  @MaxLength(1100)
  ref: string;

  @ApiPropertyOptional({ description: 'Served as a download rather than shown inline.' })
  @IsOptional()
  @IsBoolean()
  download?: boolean;
}

export class AddMediaItemDto {
  @ApiProperty({ maxLength: 2048 })
  @IsUploadedUrl()
  @MaxLength(2048)
  url: string;

  @ApiPropertyOptional({ enum: MediaType, default: MediaType.IMAGE })
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}
