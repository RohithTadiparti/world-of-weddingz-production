import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorReview } from '../vendors/entities/vendor-review.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { OfficerServiceArea } from '../verification/entities/officer-service-area.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispute } from './entities/dispute.entity';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Quotation } from '../bookings/entities/quotation.entity';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import { OfficerAvailability } from '../verification/entities/officer-availability.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { AgentsModule } from '../agents/agents.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { VerificationModule } from '../verification/verification.module';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';
import { AdminConsoleService } from './admin-console.service';
import { AdminActivityService } from './admin-activity.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminPendingCountsService } from './admin-pending-counts.service';
import { AdminCountsGateway } from './admin-counts.gateway';
import { ReportsService } from './reports.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Vendor,
      VendorReview,
      PlannerProfile,
      VendorService,
      ServiceDefinition,
      ServiceCategory,
      ServiceOffering,
      OfficerServiceArea,
      Booking,
      Dispute,
      Profile,
      ProfileDetails,
      Interest,
      Payment,
      WeddingEvent,
      AgentCharge,
      VerificationRequest,
      SupportCase,
      RefreshSession,
      OfficerAvailability,
      Notification,
      // Read-only: the price on the table while a booking's total is 0.00, and
      // the wedding a planner booking's date and place are read from.
      Quotation,
      WeddingPlan,
      // Read-only: an agency's name, for whoever raised a dispute.
      AgentProfile,
    ]),
    AgentsModule,
    // For the on-demand payout sweep: the retry lives with the booking service
    // so the split and the gateway call stay in one place.
    forwardRef(() => BookingsModule),
    // For the held price changes. The catalog owns the rule; the console only
    // asks it what is waiting and tells it what was decided.
    forwardRef(() => CatalogModule),
    // Approving a planner decides the verification request it raised.
    VerificationModule,
    AuthModule,
  ],
  providers: [
    AdminService,
    AdminConsoleService,
    AdminActivityService,
    AdminAccountsService,
    AdminBookingsService,
    AdminReportsService,
    ReportsService,
    AdminPendingCountsService,
    AdminCountsGateway,
  ],
  controllers: [AdminController],
  exports: [
    AdminService,
    AdminConsoleService,
    AdminActivityService,
    AdminAccountsService,
    AdminBookingsService,
    AdminReportsService,
    AdminPendingCountsService,
  ],
})
export class AdminModule {}
