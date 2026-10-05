import { Controller, Get, Headers, NotFoundException, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { DeliveryCaptureService, DeliveryChannel } from './delivery-capture.service';

@Controller('test-deliveries')
export class DeliveryCaptureController {
  constructor(private readonly capture: DeliveryCaptureService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('latest')
  async latest(
    @Headers('x-test-delivery-key') key: string | undefined,
    @Query('channel') channel: DeliveryChannel,
    @Query('destination') destination: string,
  ): Promise<unknown> {
    if (!this.capture.authorized(key) || !['mail', 'sms', 'whatsapp', 'push'].includes(channel)) {
      throw new NotFoundException();
    }
    return (await this.capture.latest(channel, destination)) ?? { delivery: null };
  }
}
