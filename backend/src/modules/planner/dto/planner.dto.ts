import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { TaskStatus } from '../../../common/enums';
import { IsStrictNumber } from '../../../common/decorators/strict-type.decorator';

export class CreatePlanDto {
  @ApiProperty({ example: '2026-12-01', format: 'date' })
  @IsDateString({}, { message: 'weddingDate must be an ISO date, e.g. 2026-12-01' })
  weddingDate: string;

  /** Agents create plans for the client they represent. */
  @ApiPropertyOptional({ format: 'uuid', description: 'AGENT only: the managed client' })
  @IsOptional()
  @IsUUID('4')
  onBehalfOfUserId?: string;
}

export class AddTaskDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString() @MinLength(1) @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional() @IsDateString()
  dueDate?: string;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  status: TaskStatus;
}

/** The couple's overall wedding budget; null clears it. */
export class SetWeddingBudgetDto {
  @ApiProperty({ example: 1500000, nullable: true, minimum: 0, maximum: 10_000_000_000 })
  @ValidateIf((o: SetWeddingBudgetDto) => o.budget !== null)
  @IsStrictNumber({ maxDecimalPlaces: 2 }, { message: 'budget must be an amount in rupees' })
  @Min(0)
  @Max(10_000_000_000)
  budget: number | null;
}

/** Host engages a wedding planner on a plan, or clears the engagement. */
export class EngagePlannerDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the PLANNER account to engage' })
  @IsUUID('4')
  plannerUserId: string;
}
