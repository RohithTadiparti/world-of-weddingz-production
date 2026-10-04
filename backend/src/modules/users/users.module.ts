import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from './entities/profile.entity';
import { UsersService } from './users.service';
import { IdentityService } from './identity.service';
import { UsersController } from './users.controller';
import { DataRightsService } from './data-rights.service';
import { User } from '../auth/entities/user.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { ProfileSibling } from '../profile-details/entities/profile-sibling.entity';
import { ProfileAsset } from '../profile-details/entities/profile-asset.entity';
import { ProfileConsent } from '../circulation/entities/profile-consent.entity';
import { ProfileShare } from '../circulation/entities/profile-share.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Invitation } from '../invitations/entities/invitation.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Notification } from '../notifications/entities/notification.entity';

import { AgentProfile } from '../agents/entities/agent-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Profile,
      User,
      ProfileDetails,
      AgentProfile,
      ProfileSibling,
      ProfileAsset,
      ProfileConsent,
      ProfileShare,
      Interest,
      Booking,
      Invitation,
      SupportCase,
      Vendor,
      PlannerProfile,
      Notification,
    ]),
  ],
  providers: [UsersService, IdentityService, DataRightsService],
  controllers: [UsersController],
  exports: [UsersService, IdentityService, DataRightsService, TypeOrmModule],
})
export class UsersModule {}
