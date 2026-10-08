import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ClientErrorDto {
  @IsIn(['web', 'android', 'ios'])
  platform: 'web' | 'android' | 'ios';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  release?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  route: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  category: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  stack?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  requestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceFamily?: string;
}
