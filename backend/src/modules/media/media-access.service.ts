import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { parseKey, toRef } from '../../platform/storage/storage-keys';
import { BookingsService } from '../bookings/bookings.service';
import { Vendor } from '../vendors/entities/vendor.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { Profile } from '../users/entities/profile.entity';

/** Answers already worked out during one request, so a list of forty photographs is one lookup. */
export type AccessMemo = Map<string, Promise<boolean>>;

/**
 * Who may see, attach and upload a stored object — decided from its key.
 *
 * The key names its owner (see storage-keys.ts), so these rules do not depend
 * on which row points at an object or how it got there:
 *
 *   users/{u}/profile       anyone signed in: it is shown on profiles and biodata
 *   users/{u}/albums        u
 *   users/{u}/attachments   u (evidence, receipts, chat attachments), plus the
 *                           owner and steward of a profile whose intake
 *                           biodata document it is
 *   vendors/{v}/portfolio   anyone signed in: it is the listing's shop window
 *   bookings/{b}/…          the booking's customer, their match-fixed partner,
 *                           and the provider it was booked with
 *
 * Admins see everything. Anything else — a key this platform did not mint —
 * is seen by nobody but an admin.
 */
@Injectable()
export class MediaAccessService {
  constructor(
    private readonly bookings: BookingsService,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(ProfileDetails) private readonly details: Repository<ProfileDetails>,
  ) {}

  /**
   * Whether `viewer` may be handed this object, or attach it to something.
   *
   * Used by the explicit sign route and for every reference a request body
   * carries: a person can attach what they could already open, and nothing
   * else — copying another couple's delivery key into your own profile gets a
   * 403, not a signed link.
   */
  canView(viewer: AuthUser | undefined, key: string, memo: AccessMemo = new Map()): Promise<boolean> {
    if (viewer?.role === UserRole.ADMIN) return Promise.resolve(true);
    const scope = parseKey(key);
    if (!scope || !viewer) return Promise.resolve(false);

    switch (scope.owner) {
      case 'users':
        if (scope.area === 'profile' || scope.id === viewer.userId) return Promise.resolve(true);
        // An agent uploads a client's biodata document into their own
        // attachments; the client who later claims the profile may open it too.
        if (scope.area !== 'attachments') return Promise.resolve(false);
        return this.memoised(memo, `intake:${key}`, () => this.intakeDocumentOf(viewer, key));
      case 'vendors':
        return Promise.resolve(true);
      case 'bookings':
        return this.memoised(memo, `participant:${scope.id}`, () => this.participant(viewer, scope.id));
    }
  }

  /** Whether `key` is the intake document of a profile the viewer owns or stewards. */
  private async intakeDocumentOf(viewer: AuthUser, key: string): Promise<boolean> {
    const suffix = `%/${key.replace(/[\\%_]/g, '\\$&')}`;
    const count = await this.details
      .createQueryBuilder('d')
      .innerJoin(Profile, 'p', 'p.id = d.profileId')
      .where('(d.biodataDocumentUrl = :ref OR d.biodataDocumentUrl LIKE :suffix)', {
        ref: toRef(key),
        suffix,
      })
      .andWhere('(p.userId = :viewer OR p.managedByUserId = :viewer)', { viewer: viewer.userId })
      .getCount();
    return count > 0;
  }

  /**
   * Whether a stored reference in a response may be signed for this viewer.
   *
   * Looser than `canView` on purpose. The endpoint returning the row has
   * already decided the viewer may see it — the vendor reading the couple's
   * reference photographs, the officer reading a complaint's evidence — and
   * this does not second-guess that. The one exception is a booking's files:
   * those are checked again here, so a delivery can reach nobody outside the
   * booking whichever response it turns up in.
   */
  canReceive(viewer: AuthUser | undefined, key: string, memo: AccessMemo = new Map()): Promise<boolean> {
    const scope = parseKey(key);
    if (scope?.owner !== 'bookings') return Promise.resolve(true);
    if (viewer?.role === UserRole.ADMIN) return Promise.resolve(true);
    if (!viewer) return Promise.resolve(false);
    return this.memoised(memo, `participant:${scope.id}`, () => this.participant(viewer, scope.id));
  }

  /**
   * Whether `viewer` may write this key: always a place of their own.
   *
   * A booking's deliveries are the provider's to fill; its references may come
   * from either side. An admin has no way into a person's or a listing's own
   * space; on a booking the booking's own rules apply, which let an admin act
   * for either side as they already can everywhere else on it.
   */
  async canUpload(viewer: AuthUser, key: string): Promise<boolean> {
    const scope = parseKey(key);
    if (!scope) return false;
    switch (scope.owner) {
      case 'users':
        return scope.id === viewer.userId;
      case 'vendors':
        return (await this.vendorIdOf(viewer.userId)) === scope.id;
      case 'bookings':
        return scope.area === 'deliveries'
          ? this.seller(viewer, scope.id)
          : this.participant(viewer, scope.id);
    }
  }

  /** The vendor listing this account owns, if it owns one. */
  async vendorIdOf(userId: string): Promise<string | null> {
    const vendor = await this.vendors.findOne({ where: { ownerUserId: userId }, select: ['id'] });
    return vendor?.id ?? null;
  }

  /** The booking's own rule for "on this booking", partner included. */
  private async participant(viewer: AuthUser, bookingId: string): Promise<boolean> {
    try {
      await this.bookings.forParticipant(viewer, bookingId);
      return true;
    } catch {
      return false;
    }
  }

  private async seller(viewer: AuthUser, bookingId: string): Promise<boolean> {
    try {
      const booking = await this.bookings.forParticipant(viewer, bookingId);
      await this.bookings.assertSeller(viewer, booking);
      return true;
    } catch {
      return false;
    }
  }

  private memoised(memo: AccessMemo, id: string, work: () => Promise<boolean>): Promise<boolean> {
    let answer = memo.get(id);
    if (!answer) {
      answer = work();
      memo.set(id, answer);
    }
    return answer;
  }
}
