import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReplicaLockModule } from '../../platform/locks/replica-lock.module';
import { AlertEvaluator } from './alerts/alert-evaluator';
import { CapacityCollector } from './capacity/capacity.collector';
import { CapacityScheduler } from './capacity/capacity.scheduler';
import { RequestCapacityInterceptor } from './capacity/request-capacity.interceptor';
import { RUNTIME_CAPACITY_PROVIDER } from './capacity/capacity.types';
import { RuntimeCapacityService } from './capacity/runtime-capacity.service';
import { CapacitySnapshot } from './entities/capacity-snapshot.entity';
import { OperationalAlert } from './entities/operational-alert.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CapacitySnapshot, OperationalAlert]), ReplicaLockModule],
  providers: [
    RuntimeCapacityService,
    { provide: RUNTIME_CAPACITY_PROVIDER, useExisting: RuntimeCapacityService },
    CapacityCollector,
    AlertEvaluator,
    CapacityScheduler,
    { provide: APP_INTERCEPTOR, useClass: RequestCapacityInterceptor },
  ],
  exports: [CapacityCollector, AlertEvaluator, TypeOrmModule],
})
export class OperationsModule {}
