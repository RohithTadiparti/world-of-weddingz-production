import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Media storage, global for the reason moderation is: a picture is attached
 * from a dozen modules, and the chat gateway and the moderation check both
 * need to turn a stored reference into something they can hand on.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
