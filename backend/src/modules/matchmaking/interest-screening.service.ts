import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { RedisService } from '../../platform/redis/redis.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { InterestScreening, InterestStatus, UserRole } from '../../common/enums';
import { Permission, roleHasPermission } from '../../common/authz/permissions';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/*
 * Interests to an agency's client go to the agency first.
 *
 * A family that hands its matchmaking to an agency has asked the agency to be
 * the filter: somebody interested in their daughter is the agency's to weigh
 * before it is the family's to hear about. So an interest to a profile an
 * agency runs is held (InterestScreening.WITH_AGENCY). Only the agent is told,
 * and the client's own lists, counts and match cards leave it out. The agent
 * forwards it, at which point it is an ordinary pending interest and the client
 * is told as usual, or declines it, and the client never sees it at all.
 *
 * "Runs" is the same condition the UI shows as "Managed by their agency": the
 * profile's steward is an account that holds AGENCY_MANAGE. Whether the client
 * has claimed the profile does not matter, and neither does who else can see
 * it — the hold is on the interest, so it applies to everybody but the agency.
 */

/** Held from the client: still with the agency, or turned down by it. */
export function heldFromClient(row: Pick<Interest, 'screening'>): boolean {
  return row.screening === InterestScreening.WITH_AGENCY || row.screening === InterestScreening.DECLINED;
}

/**
 * Whether this actor reads `profile`'s interests as the one screening them.
 *
 * The steward of the profile, or an admin. A family steward counts too, which
 * is harmless: only an agency's profiles ever have anything held.
 */
export function screensFor(actor: AuthUser, profile: Profile): boolean {
  if (actor.role === UserRole.ADMIN) return true;
  return profile.managedByUserId !== null && profile.managedByUserId === actor.userId;
}

/**
 * The interests `me` may be shown, as read by this actor.
 *
 * Drops the ones sent *to* `me` that are held from the client, unless the actor
 * is the one screening them. Interests `me` sent are never held from `me`: the
 * sender's side sees theirs as "with their agency".
 */
export function visibleTo<T extends Pick<Interest, 'toProfileId' | 'screening'>>(
  actor: AuthUser,
  me: Profile,
  rows: T[],
): T[] {
  if (screensFor(actor, me)) return rows;
  return rows.filter((row) => row.toProfileId !== me.id || !heldFromClient(row));
}

/**
 * The agency an interest to `target` has to go through, if any.
 *
 * None when the profile has no steward, when its steward is not an agency (a
 * family member running a relative's profile), and when the agency is the one
 * sending — an interest it chose to send is not one it needs to review.
 */
export async function screeningAgentFor(
  users: Repository<User>,
  target: Profile,
  sentByUserId: string,
): Promise<string | null> {
  const stewardId = target.managedByUserId;
  if (!stewardId || stewardId === sentByUserId) return null;
  const steward = await users.findOne({ where: { id: stewardId }, select: ['id', 'role'] });
  return steward && roleHasPermission(steward.role, Permission.AGENCY_MANAGE) ? steward.id : null;
}

/** The agent's two answers to a held interest: let it through, or turn it down. */
@Injectable()
export class InterestScreeningService {
  constructor(
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Passes a held interest on to the client.
   *
   * From here it is an ordinary pending interest: the client and their family
   * are told, it appears in their Received list, and they accept or decline it
   * as they would any other. On a profile nobody has claimed, the agent is
   * still the one who answers for it, exactly as before.
   */
  async forward(actor: AuthUser, interestId: string): Promise<Interest> {
    const interest = await this.held(actor, interestId);
    interest.screening = InterestScreening.FORWARDED;
    const saved = await this.interests.save(interest);

    await this.outbox.record({
      eventType: 'match.interest_forwarded',
      aggregateType: 'interest',
      payload: {
        interestId: interest.id,
        fromProfileId: interest.fromProfileId,
        toProfileId: interest.toProfileId,
        forwardedByUserId: actor.userId,
      },
    });
    await this.invalidateSuggestions(interest.fromProfileId, interest.toProfileId);
    return saved;
  }

  /**
   * Turns a held interest down on the client's behalf.
   *
   * Recorded as a rejection, so everything that reads one — the sender's
   * Declined list, a later re-send reopening the same row — works unchanged.
   * The screening state is what keeps it off the client's lists, and what lets
   * the sender be told it was the agency who answered.
   */
  async decline(actor: AuthUser, interestId: string): Promise<Interest> {
    const interest = await this.held(actor, interestId);
    interest.status = InterestStatus.REJECTED;
    interest.screening = InterestScreening.DECLINED;
    interest.respondedByUserId = actor.userId;
    const saved = await this.interests.save(interest);

    await this.outbox.record({
      eventType: 'match.interest_declined_by_agency',
      aggregateType: 'interest',
      payload: {
        interestId: interest.id,
        fromProfileId: interest.fromProfileId,
        toProfileId: interest.toProfileId,
        declinedByUserId: actor.userId,
      },
    });
    await this.invalidateSuggestions(interest.fromProfileId, interest.toProfileId);
    return saved;
  }

  /** Loads an interest that is waiting on this actor's review, or refuses. */
  private async held(actor: AuthUser, interestId: string): Promise<Interest> {
    const interest = await this.interests.findOne({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('Interest not found');

    const target = await this.profiles.findOne({ where: { id: interest.toProfileId } });
    if (!target || !screensFor(actor, target)) {
      throw new ForbiddenException('Only the agency managing this profile can review its interests');
    }
    if (interest.screening !== InterestScreening.WITH_AGENCY) {
      throw new BadRequestException('This interest is not waiting on the agency');
    }
    // Held but no longer pending: the sender took it back, or a fixed match
    // elsewhere closed it. There is nothing left to pass on.
    if (interest.status !== InterestStatus.PENDING) {
      throw new BadRequestException('That interest is no longer open');
    }
    return interest;
  }

  /** Same keys MatchmakingService drops: both sides' cached cards are now stale. */
  private async invalidateSuggestions(...profileIds: string[]): Promise<void> {
    const keys: string[] = [];
    for (const id of profileIds) {
      keys.push(...(await this.redis.raw.keys(`match:suggestions:${id}:*`)));
    }
    if (keys.length) await this.redis.del(...keys);
  }
}
