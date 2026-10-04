import { Module } from '@nestjs/common';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { PlanTask } from '../planner/entities/plan-task.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { WeddingInvitation } from './entities/wedding-invitation.entity';
import { Profile } from '../users/entities/profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { Quotation } from '../bookings/entities/quotation.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WeddingEvent,
      Guest,
      EventInvite,
      WeddingInvitation,
      Profile,
      Booking,
      Vendor,
      WeddingPlan,
      // The wedding plan's tasks appear on the shared event workspace (EZ1-I84);
      // read-only, so the rows are read directly rather than importing the
      // whole planner module.
      PlanTask,
      // Read-only, to name a planner booked for a day, the service booked, the
      // price quoted and a client with no profile.
      PlannerProfile,
      VendorService,
      Quotation,
      User,
    ]),
    // Syncing a shared event to the other party raises a notification (EZ1-I84).
    NotificationsModule,
    // Names the match-fixed partner on the wedding invitation.
    MatchmakingModule,
  ],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class WeddingEventsModule {}
