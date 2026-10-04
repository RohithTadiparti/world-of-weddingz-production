import { Global, Module } from '@nestjs/common';
import { DeliveryCaptureController } from './delivery-capture.controller';
import { DeliveryCaptureService } from './delivery-capture.service';

@Global()
@Module({
  controllers: [DeliveryCaptureController],
  providers: [DeliveryCaptureService],
  exports: [DeliveryCaptureService],
})
export class DeliveryCaptureModule {}
