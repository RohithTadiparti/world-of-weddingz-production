import { Global, Module } from '@nestjs/common';
import { ReplicaLockService } from './replica-lock.service';

@Global()
@Module({
  providers: [ReplicaLockService],
  exports: [ReplicaLockService],
})
export class ReplicaLockModule {}
