import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import {
  BookingStatus,
  CaseStatus,
  InterestScreening,
  InterestStatus,
  ProfileClaimStatus,
  UserRole,
} from '../../common/enums';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { User } from '../auth/entities/user.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { ModerationService } from '../../platform/moderation/moderation.service';

/**
 * The account holder's own profile.
 *
 * This used to keep a Redis copy of the profile row, and that cache is the
 * single most-reported defect on this platform: *values in the database not
 * appearing in the UI*.
 *
 * The mechanism was simple and completely invisible from any one file.
 * `getByUserId` cached the row for five minutes, and exactly one place in the
 * codebase — `upsert`, immediately below — knew to clear it. Thirteen other
 * files write to `profiles`: identity submission, Aadhaar verification, the
 * match lifecycle, agency stewardship, invitations, claim requests, consent,
 * sharing, officer allocation and the scheduled jobs. Every one of them left a
 * stale copy behind. So a person could verify their identity, watch the
 * identity endpoint report it confirmed, reload the page, and be told they were
 * unverified — for five minutes, with no way to tell why.
 *
 * The cache is gone rather than patched. What it saved was one indexed lookup
 * by `userId` on page load; what it cost was correctness across thirteen
 * writers, and any fix that leaves the cache in place is a fourteenth writer
 * away from the same bug. If profile reads ever genuinely become a bottleneck,
 * the version to write is one that cannot be forgotten — a TypeORM entity
 * subscriber on `Profile` — not another `del` at another call site.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ProfileDetails) private readonly details: Repository<ProfileDetails>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    private readonly moderation: ModerationService,
  ) {}

  /** Bride and groom are fixed individual personas, not a value users can accidentally contradict. */
  genderForRole(role: UserRole): string | null {
    if (role === UserRole.BRIDE) return 'female';
    if (role === UserRole.GROOM) return 'male';
    return null;
  }

  async upsert(
    userId: string,
    dto: CreateProfileDto | UpdateProfileDto,
    role?: UserRole,
  ): Promise<Profile> {
    const roleGender = role ? this.genderForRole(role) : null;
    const fields = roleGender ? { ...dto, gender: roleGender } : dto;
    let profile = await this.profiles.findOne({ where: { userId } });

    // The profile form can carry the whole photo list, so this is an attach
    // point like the biodata gallery: a photograph that is new to this profile
    // is checked for AI generation before anything is saved.
    if (dto.photos) {
      await this.moderation.assertGenuinePhotos(dto.photos, profile?.photos, { userId, kind: 'profile' });
    }
    if (!profile) {
      profile = this.profiles.create({
        userId,
        ...fields,
        // Self-managed from the outset; stewardship is set only by the agent
        // paths in ManagedProfilesService.
        claimStatus: ProfileClaimStatus.SELF,
      } as Partial<Profile>);
    } else {
      Object.assign(profile, fields);
    }
    profile.profileCompleted = this.isComplete(profile);
    return this.profiles.save(profile);
  }

  async getByUserId(userId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async navigationCounts(actor: { userId: string; role: UserRole }): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    if (actor.role === UserRole.VENDOR || actor.role === UserRole.PLANNER) {
      const providerIds = actor.role === UserRole.VENDOR
        ? (await this.vendors.find({ where: { ownerUserId: actor.userId }, select: ['id'] })).map((v) => v.id)
        : (await this.planners.find({ where: { ownerUserId: actor.userId }, select: ['id'] })).map((p) => p.id);

      if (providerIds.length > 0) {
        counts['/bookings'] = await this.bookings
          .createQueryBuilder('b')
          .where('b."providerId" IN (:...ids)', { ids: providerIds })
          .andWhere('b.status IN (:...statuses)', {
            statuses: [
              BookingStatus.REQUESTED,
              BookingStatus.QUOTATION_SENT,
              BookingStatus.QUOTATION_ACCEPTED,
              BookingStatus.PAYMENT_PENDING,
              BookingStatus.PENDING,
              BookingStatus.CONFIRMED,
              BookingStatus.IN_PROGRESS,
              BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
              BookingStatus.DISPUTED,
            ],
          })
          .getCount();
      }
    }

    if (actor.role === UserRole.AGENT) {
      const clients = await this.profiles.find({
        where: { managedByUserId: actor.userId },
        select: ['id'],
      });
      if (clients.length > 0) {
        const clientIds = clients.map((c) => c.id);
        const pendingInterests = await this.interests
          .createQueryBuilder('i')
          .where('i."toProfileId" IN (:...ids)', { ids: clientIds })
          .andWhere('i.status = :status', { status: InterestStatus.PENDING })
          // NULL is the usual value, an interest never held for screening, and
          // `IN (..., NULL)` never matches it, so it is asked for separately.
          .andWhere('(i.screening IN (:...screening) OR i.screening IS NULL)', {
            screening: [InterestScreening.WITH_AGENCY, InterestScreening.FORWARDED],
          })
          .getCount();
        counts['/interests'] = pendingInterests;

        counts['/clients'] = await this.interests
          .createQueryBuilder('i')
          .select('DISTINCT i."toProfileId"', 'profileId')
          .where('i."toProfileId" IN (:...ids)', { ids: clientIds })
          .andWhere('i.status = :status', { status: InterestStatus.PENDING })
          .andWhere('(i.screening IN (:...screening) OR i.screening IS NULL)', {
            screening: [InterestScreening.WITH_AGENCY, InterestScreening.FORWARDED],
          })
          .getRawMany()
          .then((rows) => rows.length);
      }
    }

    if (actor.role === UserRole.IN_PERSON) {
      const active = [
        CaseStatus.OPEN,
        CaseStatus.TRIAGED,
        CaseStatus.ALLOCATED,
        CaseStatus.IN_PROGRESS,
        CaseStatus.WAITING_FOR_INFORMATION,
        CaseStatus.RESOLUTION_SUBMITTED,
        CaseStatus.ADMIN_REVIEW,
        CaseStatus.REASSIGNED,
        CaseStatus.ESCALATED,
      ];
      counts['/cases'] = await this.cases.count({
        where: { assignedToUserId: actor.userId, status: In(active) },
      });
      // The same queue, shown on both entries.
      counts['/support'] = counts['/cases'];
    }

    counts['/notifications'] = await this.notifications.count({
      where: { userId: actor.userId, isRead: false },
    });

    return counts;
  }

  async resolveAccountName(userId: string, profile: Profile): Promise<string | null> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) return profile.displayName;

    if (user.role === UserRole.FAMILY) {
      const details = await this.details.findOne({ where: { profileId: profile.id } });
      const rel = (profile.stewardRelation ?? '').trim().toLowerCase();

      if (rel === 'father' && details?.father && typeof details.father === 'object' && (details.father as { name: string }).name) {
        return (details.father as { name: string }).name;
      }
      if (rel === 'mother' && details?.mother && typeof details.mother === 'object' && (details.mother as { name: string }).name) {
        return (details.mother as { name: string }).name;
      }
      if (rel === 'guardian' && details && 'guardian' in details && details.guardian && typeof details.guardian === 'object' && (details.guardian as { name: string }).name) {
        return (details.guardian as { name: string }).name;
      }

      if (!profile.managingFor && profile.displayName) {
        return profile.displayName;
      }
      if (user.email) {
        return user.email.split('@')[0];
      }
      return profile.displayName;
    }

    if (user.role === UserRole.AGENT) {
      const agency = await this.agencies.findOne({ where: { ownerUserId: user.id } });
      if (agency?.agencyName) return agency.agencyName;
    }

    return profile.displayName;
  }

  private isComplete(p: Profile): boolean {
    return Boolean(p.displayName && p.gender && p.dateOfBirth && p.city);
  }
}
