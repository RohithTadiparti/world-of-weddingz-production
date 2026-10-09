import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/authz/permissions';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  AcknowledgeAlertResponse,
  MigrationReadinessResponse,
  OperationalAlertQueryDto,
  OperationalAlertsResponse,
  OperationsStatusResponse,
} from './dto/operations.dto';
import { OperationsDashboardService } from './operations-dashboard.service';

/**
 * The administrator Infrastructure dashboard API (UI-001).
 *
 * Every route needs `admin:infrastructure:read`, including acknowledgement:
 * acknowledging records who has picked an alert up and changes no
 * infrastructure. `admin:infrastructure:migrate` is reserved for the
 * migration endpoints (MIG-001), which also require step-up (AUTH-001); this
 * controller deliberately exposes no migration action.
 */
@ApiTags('admin-operations')
@ApiBearerAuth()
@RequirePermissions(Permission.ADMIN_INFRASTRUCTURE_READ)
@Controller('admin/operations')
export class OperationsController {
  constructor(private readonly dashboard: OperationsDashboardService) {}

  @ApiOperation({
    summary: 'Capacity status from the latest persisted snapshot',
    description:
      'Exact persisted value and unit per metric, configured thresholds, collection time, source, ' +
      'freshness and derived status. Missing or stale data is unknown, never ok.',
  })
  @Get('status')
  status(): Promise<OperationsStatusResponse> {
    return this.dashboard.status();
  }

  @ApiOperation({
    summary: 'Operational alerts, critical first then most recent',
    description: 'Delivery state is reduced to non-secret counts, statuses, timestamps and error codes.',
  })
  @Get('alerts')
  alerts(@Query() query: OperationalAlertQueryDto): Promise<OperationalAlertsResponse> {
    return this.dashboard.list(query.status);
  }

  @ApiOperation({
    summary: 'Acknowledge an operational alert (idempotent)',
    description:
      'The first acknowledgement stores the actor and time and records the audit; a repeat returns ' +
      'the persisted acknowledgement unchanged. 404 for an unknown alert, 409 for a resolved alert ' +
      'nobody acknowledged.',
  })
  @HttpCode(200)
  @Post('alerts/:id/acknowledge')
  acknowledge(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AcknowledgeAlertResponse> {
    return this.dashboard.acknowledge(id, actor.userId);
  }

  @ApiOperation({
    summary: 'Migration readiness and every unmet prerequisite',
    description: 'Read-only. There is no migration start endpoint here.',
  })
  @Get('migration-readiness')
  migrationReadiness(): Promise<MigrationReadinessResponse> {
    return this.dashboard.readiness();
  }
}
