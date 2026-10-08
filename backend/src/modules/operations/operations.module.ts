import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReplicaLockModule } from '../../platform/locks/replica-lock.module';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertDeliveryService } from './alerts/alert-delivery.service';
import { AlertEvaluator } from './alerts/alert-evaluator';
import { CapacityCollector } from './capacity/capacity.collector';
import { CapacityScheduler } from './capacity/capacity.scheduler';
import { RequestCapacityInterceptor } from './capacity/request-capacity.interceptor';
import { RUNTIME_CAPACITY_PROVIDER } from './capacity/capacity.types';
import { RuntimeCapacityService } from './capacity/runtime-capacity.service';
import { CapacitySnapshot } from './entities/capacity-snapshot.entity';
import { OperationalAlert } from './entities/operational-alert.entity';
import { OperationsDashboardService } from './operations-dashboard.service';
import { OperationsController } from './operations.controller';

@Module({
  imports: [
    // User is read-only here: it resolves which active administrators hold
    // the infrastructure permission and should be notified.
    TypeOrmModule.forFeature([CapacitySnapshot, OperationalAlert, User]),
    ReplicaLockModule,
    NotificationsModule,
  ],
  controllers: [OperationsController],
  providers: [
    RuntimeCapacityService,
    { provide: RUNTIME_CAPACITY_PROVIDER, useExisting: RuntimeCapacityService },
    CapacityCollector,
    AlertEvaluator,
    AlertDeliveryService,
    OperationsDashboardService,
    CapacityScheduler,
    { provide: APP_INTERCEPTOR, useClass: RequestCapacityInterceptor },
  ],
  exports: [CapacityCollector, AlertEvaluator, AlertDeliveryService, TypeOrmModule],
})
export class OperationsModule {}
