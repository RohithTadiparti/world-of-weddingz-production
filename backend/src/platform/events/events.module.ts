import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxProcessor } from './outbox.processor';
import { EventBus } from './event-bus.service';
import { ReplicaLockModule } from '../locks/replica-lock.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent]), ReplicaLockModule],
  providers: [EventBus, OutboxService, OutboxProcessor],
  exports: [EventBus, OutboxService],
})
export class EventsModule {}
