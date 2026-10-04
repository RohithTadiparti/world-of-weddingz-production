import { Module, forwardRef } from '@nestjs/common';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { VendorsModule } from '../vendors/vendors.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { MockAiProvider, OpenAiProvider, aiProviderFactory } from './ai.provider';

@Module({
  imports: [forwardRef(() => MatchmakingModule), forwardRef(() => VendorsModule)],
  providers: [AiService, MockAiProvider, OpenAiProvider, aiProviderFactory],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
