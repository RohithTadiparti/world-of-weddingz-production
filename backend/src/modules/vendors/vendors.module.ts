import { Module, forwardRef } from '@nestjs/common';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { BusinessLifecycleService } from './business-lifecycle.service';
import { VerificationModule } from '../verification/verification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VendorReview } from './entities/vendor-review.entity';
import { VendorAvailabilitySlot } from './entities/vendor-availability-slot.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { VendorsService } from './vendors.service';
import { AvailabilityService } from './availability.service';
import { AdminReviewsController, VendorsController } from './vendors.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PayoutBankService } from './payout-bank.service';
import { PayoutAccountsService } from './payout-accounts.service';
import { PayoutBankAccount } from './entities/payout-bank-account.entity';

@Module({
  imports: [
    forwardRef(() => VerificationModule),
    NotificationsModule,
    TypeOrmModule.forFeature([
      Vendor,
      // Read-only, to check a listing's categories against the catalogue (EZ1-I263).
      ServiceCategory,
      VendorReview,
      VendorAvailabilitySlot,
      VendorService,
      ServiceOffering,
      // Read-only, to put the service, package and booking on the vendor's own
      // reviews view (EZ1-I103).
      Booking,
      // Read-only, to name the reviewer for an administrator.
      User,
      Profile,
      // So availability can ask whether a planner listing is yours, and the
      // payout form can set where a planner is paid.
      PlannerProfile,
      SupportCase,
      // Submitted payout bank details, sealed; see PayoutAccountsService.
      PayoutBankAccount,
    ]),
    forwardRef(() => BookingsModule),
    forwardRef(() => CatalogModule),
  ],
  providers: [
    VendorsService,
    AvailabilityService,
    BusinessLifecycleService,
    PayoutBankService,
    PayoutAccountsService,
  ],
  controllers: [VendorsController, AdminReviewsController],
  exports: [
    VendorsService,
    AvailabilityService,
    TypeOrmModule,
    BusinessLifecycleService,
    PayoutBankService,
    PayoutAccountsService,
  ],
})
export class VendorsModule {}
