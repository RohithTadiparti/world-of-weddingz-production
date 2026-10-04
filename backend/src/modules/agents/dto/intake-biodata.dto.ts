import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { LocationDto, ParentDto } from '../../profile-details/dto/profile-details.dto';

/** Reviewed intake values, stored in the existing profile_details row. */
const trimAndTruncate = (length: number) => {
  // Length is enforced by the paired @MaxLength decorator; intake must reject
  // oversized input rather than silently turning it into a different value.
  void length;
  return Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
};

/**
 * The regular biodata form requires a parent's name. Document extraction often
 * yields only a profession or life status, so intake uses the same schema with
 * every field optional rather than weakening the interactive form's DTO.
 */
class IntakeParentDto extends PartialType(ParentDto) {}

/** The optional chart facts that document intake can recover independently. */
class IntakeHoroscopeDto {
  @IsOptional() @IsString() @MaxLength(60) rashi?: string;
  @IsOptional() @IsString() @MaxLength(60) star?: string;
  @IsOptional() @IsString() @MaxLength(20) padam?: string;
  @IsOptional() @IsString() @MaxLength(60) gothram?: string;
  @IsOptional() @IsString() @MaxLength(20) kujaDosham?: string;
  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeOfBirth?: string;
  @IsOptional() @ValidateNested() @Type(() => LocationDto) birthPlace?: LocationDto;
  @IsOptional() @IsUploadedUrl() @MaxLength(2048) horoscopeDocumentUrl?: string;
}

/** The fields used by the existing biodata education section for an employee. */
class IntakeEmploymentDto {
  @IsOptional() @IsString() @MaxLength(120) role?: string;
  @IsOptional() @IsString() @MaxLength(120) designation?: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(120) workLocation?: string;
  @IsOptional() @IsString() @MaxLength(40) salary?: string;
}

/** The fields used by the existing biodata education section for a business. */
class IntakeBusinessDto {
  @IsOptional() @IsString() @MaxLength(160) businessName?: string;
  @IsOptional() @IsString() @MaxLength(40) businessIncome?: string;
  @IsOptional() @IsString() @MaxLength(120) businessLocation?: string;
  // Older readers use these aliases; retaining them avoids changing an
  // already accepted intake payload while keeping the JSON shape bounded.
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(40) income?: string;
  @IsOptional() @IsString() @MaxLength(120) location?: string;
}

/** Intake values from uploaded biodata document, stored in the existing profile_details row. */
export class IntakeBiodataDto {
  @IsOptional() @IsString() @trimAndTruncate(80) @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @trimAndTruncate(80) @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @trimAndTruncate(80) @MaxLength(80) surname?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(250) heightCm?: number;
  @IsOptional() @IsString() @trimAndTruncate(40) @MaxLength(40) complexion?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) nativePlace?: string;
  @IsOptional() @IsString() @trimAndTruncate(80) @MaxLength(80) nativeState?: string;
  @IsOptional() @IsString() @trimAndTruncate(80) @MaxLength(80) nativeCountry?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) nativeDistrict?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) placeOfBirth?: string;
  @IsOptional() @IsString() @trimAndTruncate(500) @MaxLength(500) communicationAddress?: string;
  @IsOptional() @IsString() @trimAndTruncate(500) @MaxLength(500) address?: string;
  // The profile's own name, mobile, email, date of birth, gender and city are
  // top-level fields of CreateManagedProfileDto, not part of the biodata.
  @IsOptional() @IsString() @trimAndTruncate(20) @MaxLength(20) alternateMobile?: string;

  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) religion?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) caste?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) subCaste?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) motherTongue?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) denomination?: string;

  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) gothram?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) rashi?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) star?: string;
  @IsOptional() @IsString() @trimAndTruncate(20) @MaxLength(20) padam?: string;
  @IsOptional() @IsString() @trimAndTruncate(20) @MaxLength(20) kujaDosham?: string;
  @IsOptional()
  @IsString()
  @trimAndTruncate(20)
  @MaxLength(20)
  timeOfBirth?: string;
  @IsOptional() @IsBoolean() horoscopeAvailable?: boolean;

  @IsOptional() @IsString() @trimAndTruncate(40) @MaxLength(40) maritalStatus?: string;

  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) fatherName?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) fatherProfession?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) motherName?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) motherProfession?: string;
  @IsOptional() @IsString() @trimAndTruncate(40) @MaxLength(40) familyType?: string;
  @IsOptional() @IsString() @trimAndTruncate(60) @MaxLength(60) familyStatus?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) brothers?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) sisters?: number;

  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) highestQualification?: string;
  @IsOptional() @IsString() @trimAndTruncate(160) @MaxLength(160) course?: string;
  @IsOptional() @IsString() @trimAndTruncate(160) @MaxLength(160) institution?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) collegePlace?: string;
  @IsOptional() @IsString() @trimAndTruncate(40) @MaxLength(40) occupationStatus?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) profession?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) designation?: string;
  @IsOptional() @IsString() @trimAndTruncate(160) @MaxLength(160) company?: string;
  @IsOptional() @IsString() @trimAndTruncate(120) @MaxLength(120) workLocation?: string;
  @IsOptional() @IsString() @trimAndTruncate(40) @MaxLength(40) annualIncome?: string;
  @IsOptional() @IsString() @trimAndTruncate(40) @MaxLength(40) salary?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => IntakeParentDto) father?: IntakeParentDto;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => IntakeParentDto) mother?: IntakeParentDto;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IntakeHoroscopeDto)
  horoscope?: IntakeHoroscopeDto;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IntakeEmploymentDto)
  employment?: IntakeEmploymentDto;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IntakeBusinessDto)
  business?: IntakeBusinessDto;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => LocationDto) residence?: LocationDto;
  @IsOptional() @IsString() @trimAndTruncate(2000) @MaxLength(2000) bio?: string;
}
