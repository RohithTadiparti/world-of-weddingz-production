import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Notification } from './entities/notification.entity';
import { Profile } from '../users/entities/profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { User } from '../auth/entities/user.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsConsumer } from './notifications.consumer';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [
    // Read-only across module lines: the consumer resolves who to tell from
    // the booking itself rather than making every publisher duplicate the
    // same six fields into its event payload.
    TypeOrmModule.forFeature([
      Notification,
      Profile,
      Booking,
      Vendor,
      PlannerProfile,
      VendorService,
      ServiceDefinition,
      // For the WhatsApp opt-in and the number to send to. Read-only.
      User,
      // The linked function's date on a booking notification. Read-only.
      WeddingEvent,
    ]),
    // The handshake on the notifications socket verifies the access token.
    JwtModule.register({}),
  ],
  providers: [NotificationsService, NotificationsConsumer, NotificationsGateway],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
