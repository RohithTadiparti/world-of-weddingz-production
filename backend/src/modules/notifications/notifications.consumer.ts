import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventBus } from '../../platform/events/event-bus.service';
import { NotificationsService } from './notifications.service';
import { Profile } from '../users/entities/profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { User } from '../auth/entities/user.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import {
  InterestScreening,
  NotificationType,
  ProviderType,
  UserRole,
} from '../../common/enums';
import { Permission, roleHasPermission } from '../../common/authz/permissions';
import { bookingContextOf } from '../bookings/booking-venue';
import { displayNamesByUserIds } from '../users/display-names';
import { profilePhotoOf } from '../users/dto/public-profile.dto';

/**
 * Translates domain events (delivered via the outbox to the event bus) into
 * user notifications. This is the seam where SMS/email/push fan-out plugs in.
 *
 * Matchmaking events carry *profile* ids, not user ids, because a profile an
 * agency built is matchable before its subject has an account. So every
 * notification here starts by asking who to actually tell: the profile's owner
 * if it has one, otherwise the steward who runs it — for a walk-in client the
 * agent is their entire interface, and a notification into the void helps
 * nobody.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly bus: EventBus,
    private readonly notifications: NotificationsService,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(VendorService) private readonly services: Repository<VendorService>,
    @InjectRepository(ServiceDefinition)
    private readonly definitions: Repository<ServiceDefinition>,
    // Read-only: who a canceller is, and the email that names an account with
    // no profile.
    @InjectRepository(User) private readonly users: Repository<User>,
    // Read-only: the linked function's date, which is the booking's date.
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
  ) {}

  onModuleInit() {
    this.bus
      .on<{
        interestId: string;
        fromProfileId: string;
        toProfileId: string;
        sentByUserId?: string;
        screening?: string | null;
      }>('match.interest_sent')
      .subscribe((e) => {
        // Held for the agency running the profile: the agency is asked to
        // review it, and nobody else hears about it until it is forwarded.
        if (e.payload.screening === InterestScreening.WITH_AGENCY) {
          void this.notifyManagingAgent(e.payload).catch((err) =>
            this.logger.error('notify managing agent failed', err),
          );
          return;
        }
        // Both parties, but only one of them is told: the counterpart's name is
        // worked out by finding the other profile in this list, so passing the
        // recipient alone left nobody to name and every incoming interest read
        // "Someone would like to take your profile forward."
        void this.notifyProfiles(
          [e.payload.fromProfileId, e.payload.toProfileId],
          NotificationType.MATCH_INTEREST,
          e.payload,
          [e.payload.toProfileId],
        ).catch((err) => this.logger.error('notify interest failed', err));
      });

    // The agency let it through: now the client hears about it, as an
    // ordinary interest. On a profile nobody has claimed the agent is the only
    // reader, and has just read it, so nobody is told.
    this.bus
      .on<{ interestId: string; fromProfileId: string; toProfileId: string }>(
        'match.interest_forwarded',
      )
      .subscribe((e) => {
        void this.notifyForwarded(e.payload).catch((err) =>
          this.logger.error('notify forwarded interest failed', err),
        );
      });

    // The agency turned it down. The sender is told, and told it was the
    // agency: the person it was for never saw it.
    this.bus
      .on<{ interestId: string; fromProfileId: string; toProfileId: string }>(
        'match.interest_declined_by_agency',
      )
      .subscribe((e) => {
        void this.notifyProfiles(
          [e.payload.fromProfileId, e.payload.toProfileId],
          NotificationType.MATCH_DECLINED_BY_AGENCY,
          e.payload,
          [e.payload.fromProfileId],
        ).catch((err) => this.logger.error('notify agency decline failed', err));
      });

    this.bus
      .on<{ interestId: string; profileA: string; profileB: string }>('match.accepted')
      .subscribe((e) => {
        void this.notifyProfiles(
          [e.payload.profileA, e.payload.profileB],
          NotificationType.MATCH_ACCEPTED,
          e.payload,
        ).catch((err) => this.logger.error('notify accepted failed', err));
      });

    this.bus
      .on<{ interestId: string; fromProfileId: string; toProfileId: string }>('match.fixed')
      .subscribe((e) => {
        void this.notifyProfiles(
          [e.payload.fromProfileId, e.payload.toProfileId],
          NotificationType.MATCH_ACCEPTED,
          e.payload,
        ).catch((err) => this.logger.error('notify match fixed failed', err));
      });

    /*
     * An agency's two clients have started talking, or started a call.
     *
     * Sent to the steward rather than to either side of the couple: they are
     * the only person who cannot otherwise tell, and until now an agency heard
     * nothing between making an introduction and somebody ringing them about
     * it. Created directly rather than through notifyProfiles, because the
     * recipient here is not one of the parties.
     */
    this.bus
      .on<{
        stewardUserId: string;
        kind: 'message' | 'call';
        coupleNames: string;
        counterpartProfileId: string;
      }>('match.conversation_started')
      .subscribe((e) => {
        void this.notifications
          .create(e.payload.stewardUserId, NotificationType.MATCH_CONVERSATION, e.payload)
          .catch((err) => this.logger.error('notify conversation failed', err));
      });

    // ------------------------------------------------------------- bookings
    //
    // Every one of these existed as an outbox event and reached nobody. A
    // vendor's whole working day arrives through these, and the one that
    // matters most is the first: a request nobody told them about is a request
    // they answer three days late.
    const bookingEvents: { event: string; type: NotificationType; to: 'seller' | 'buyer' | 'both' }[] =
      [
        { event: 'booking.requested', type: NotificationType.BOOKING_REQUEST, to: 'seller' },
        {
          event: 'booking.request_accepted',
          type: NotificationType.BOOKING_REQUEST_ACCEPTED,
          to: 'buyer',
        },
        { event: 'booking.quotation_sent', type: NotificationType.BOOKING_QUOTATION, to: 'buyer' },
        {
          event: 'booking.quotation_accepted',
          type: NotificationType.BOOKING_QUOTATION,
          to: 'seller',
        },
        { event: 'booking.confirmed', type: NotificationType.BOOKING_CONFIRMED, to: 'buyer' },
        { event: 'booking.payment_held', type: NotificationType.BOOKING_PAYMENT, to: 'seller' },
        { event: 'booking.started', type: NotificationType.BOOKING_STARTED, to: 'buyer' },
        { event: 'booking.work_completed', type: NotificationType.BOOKING_COMPLETED, to: 'buyer' },
        { event: 'booking.cancelled', type: NotificationType.BOOKING_CANCELLED, to: 'both' },
        // An add-on is a question waiting on a price. It reached the vendor
        // only if they happened to open the booking (EZ1-I254).
        { event: 'booking.addon_requested', type: NotificationType.BOOKING_ADDON, to: 'seller' },
      ];

    for (const { event, type, to } of bookingEvents) {
      this.bus.on<{ bookingId: string }>(event).subscribe((e) => {
        void this.notifyBooking(e.payload.bookingId, type, to, e.payload).catch((err) =>
          this.logger.error(`notify ${event} failed`, err),
        );
      });
    }
  }

  /**
   * Tells whichever side of a booking needs to know.
   *
   * The event payloads are thin — most carry a booking id and little else — so
   * the row is read here rather than every publisher being made to duplicate
   * the same fields. The notification then carries enough for the list to be
   * readable without opening anything: who, what service, which date, which
   * window, and a short reference somebody can quote on the phone.
   */
  private async notifyBooking(
    bookingId: string,
    type: NotificationType,
    to: 'seller' | 'buyer' | 'both',
    extra: Record<string, unknown>,
  ): Promise<void> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) return;

    const seller = await this.provider(booking);
    const sellerUserId = seller?.ownerUserId ?? null;
    const recipients = new Set<string>();
    if (to !== 'buyer' && sellerUserId) recipients.add(sellerUserId);
    if (to !== 'seller') {
      recipients.add(booking.userId);
      // A planner or agent who placed the request for the couple is waiting on
      // the answer too; telling only the couple left them to find out by
      // opening the booking.
      if (booking.bookedByUserId && booking.bookedByUserId !== booking.userId) {
        recipients.add(booking.bookedByUserId);
      }
    }

    // A directed event already encodes who did it — a request goes to the
    // seller precisely because the buyer sent it — so nothing needs
    // suppressing there. Only a `both` event can reach its own author, and for
    // those the payload names them.
    if (to === 'both' && typeof extra.cancelledBy === 'string') {
      recipients.delete(extra.cancelledBy);
    }
    if (recipients.size === 0) return;

    const cancelledBy = typeof extra.cancelledBy === 'string' ? extra.cancelledBy : null;
    const [buyerProfile, buyer, serviceName, event, canceller] = await Promise.all([
      this.profiles.findOne({ where: { userId: booking.userId } }),
      this.users.findOne({ where: { id: booking.userId }, select: ['id', 'email'] }),
      this.serviceName(booking),
      booking.eventId
        ? this.events.findOne({ where: { id: booking.eventId } })
        : Promise.resolve(null),
      cancelledBy
        ? this.users.findOne({ where: { id: cancelledBy }, select: ['id', 'role'] })
        : Promise.resolve(null),
    ]);

    // Who cancelled, in words the recipient can act on (EZ1-I77): the side and
    // their name, resolved from the payload's cancelledBy. A provider is named
    // by their business, because most provider accounts have no profile, and
    // anybody who is neither party nor acting for the customer is platform
    // staff — which used to read as "the provider" with no name.
    let cancelledByName: string | null = null;
    let cancelledByRole: string | null = null;
    if (cancelledBy) {
      if (cancelledBy === sellerUserId) {
        cancelledByRole = 'the provider';
        cancelledByName = seller?.name ?? null;
      } else if (canceller?.role === UserRole.ADMIN || canceller?.role === UserRole.IN_PERSON) {
        cancelledByRole = 'the support team';
        cancelledByName = 'Support team';
      } else {
        cancelledByRole = 'the customer';
        const names = await displayNamesByUserIds(
          {
            users: this.users,
            profiles: this.profiles,
            vendors: this.vendors,
            planners: this.planners,
          },
          [cancelledBy],
        );
        cancelledByName = names.get(cancelledBy) ?? null;
      }
    }

    const payload = {
      ...extra,
      bookingId: booking.id,
      // Short enough to read out, long enough not to collide in one vendor's book.
      reference: booking.id.slice(0, 8),
      status: booking.status,
      clientName: buyerProfile?.displayName ?? buyer?.email ?? 'A client',
      service: serviceName,
      // The linked function's date, else the booking's own, else the date on
      // the booking form — the same date the booking itself shows.
      eventDate: bookingContextOf(booking, event).eventDate,
      slotId: booking.slotId,
      // An event that carries its own amount — a quotation's price, an
      // instalment — keeps it. Spreading the booking total over it told a
      // couple they had been quoted 0.00 on a request not yet priced.
      amount: extra.amount ?? booking.amount,
      currency: booking.currency,
      cancelledByName,
      cancelledByRole,
    };

    for (const userId of recipients) {
      await this.notifications.create(userId, type, payload);
    }
  }

  /** The account that owns the booked listing, and the business's name. */
  private async provider(
    booking: Booking,
  ): Promise<{ ownerUserId: string; name: string | null } | null> {
    if (booking.providerType === ProviderType.VENDOR) {
      const vendor = await this.vendors.findOne({ where: { id: booking.providerId } });
      return vendor ? { ownerUserId: vendor.ownerUserId, name: vendor.name ?? null } : null;
    }
    const planner = await this.planners.findOne({ where: { id: booking.providerId } });
    return planner ? { ownerUserId: planner.ownerUserId, name: planner.agencyName ?? null } : null;
  }

  /** What was booked, in words. Falls back gracefully for pre-catalog rows. */
  private async serviceName(booking: Booking): Promise<string | null> {
    // A planner is booked for the whole wedding, not a catalog service; the
    // booking lists say "Wedding planning" for the same row.
    if (!booking.vendorServiceId && booking.providerType === ProviderType.PLANNER) {
      return 'Wedding planning';
    }
    if (!booking.vendorServiceId) return null;
    const service = await this.services.findOne({ where: { id: booking.vendorServiceId } });
    if (!service) return null;
    if (service.displayName) return service.displayName;
    const definition = await this.definitions.findOne({ where: { id: service.definitionId } });
    return definition?.name ?? null;
  }

  /**
   * Asks the agency that manages the profile an interest was sent to to review
   * it.
   *
   * Only for an interest held for the agency (InterestScreening.WITH_AGENCY),
   * which the sender marks — so the agency never sent it itself. This is the
   * only notification such an interest raises until the agency forwards it,
   * whether or not the client has claimed their profile. The recipient is
   * checked again here rather than trusted: a profile whose steward is not an
   * agency has nobody to ask.
   */
  private async notifyManagingAgent(payload: {
    interestId: string;
    fromProfileId: string;
    toProfileId: string;
    sentByUserId?: string;
  }): Promise<void> {
    const profiles = await this.profiles.find({
      where: { id: In([payload.fromProfileId, payload.toProfileId]) },
    });
    const target = profiles.find((p) => p.id === payload.toProfileId);
    const from = profiles.find((p) => p.id === payload.fromProfileId);
    const agentId = target?.managedByUserId;
    if (!target || !from || !agentId || agentId === payload.sentByUserId) return;
    // Agencies only — the profiles that carry "Managed by their agency".
    const steward = await this.users.findOne({ where: { id: agentId }, select: ['id', 'role'] });
    if (!steward || !roleHasPermission(steward.role, Permission.AGENCY_MANAGE)) return;

    await this.notifications.create(agentId, NotificationType.MATCH_INTEREST_FOR_CLIENT, {
      ...payload,
      counterpartProfileId: from.id,
      counterpartName: from.displayName ?? null,
      counterpartCity: from.city ?? null,
      counterpartPhotoUrl: profilePhotoOf(from),
      // The agency's own client, named so an agency running many can tell
      // which of them this is about.
      subjectProfileId: target.id,
      subjectName: target.displayName ?? null,
    });
  }

  /** The client's ordinary interest notification, once the agency forwards. */
  private async notifyForwarded(payload: {
    interestId: string;
    fromProfileId: string;
    toProfileId: string;
  }): Promise<void> {
    const target = await this.profiles.findOne({ where: { id: payload.toProfileId } });
    if (!target?.userId || target.userId === target.managedByUserId) return;
    await this.notifyProfiles(
      [payload.fromProfileId, payload.toProfileId],
      NotificationType.MATCH_INTEREST,
      payload,
      [payload.toProfileId],
    );
  }

  /**
   * Sends one notification per profile, to whoever is actually reachable for
   * it. Duplicates are collapsed: an agency that runs both sides of a match
   * should be told once, not twice.
   */
  /**
   * @param profileIds  everyone involved, which is what the counterpart is
   *                    worked out from.
   * @param notifyIds   who actually receives it. Defaults to everyone
   *                    involved, which is right for a mutual event like an
   *                    acceptance and wrong for a one-directional one: an
   *                    interest names its sender but is only sent to its
   *                    recipient.
   */
  private async notifyProfiles(
    profileIds: string[],
    type: NotificationType,
    payload: Record<string, unknown>,
    notifyIds: string[] = profileIds,
  ): Promise<void> {
    const profiles = await this.profiles.find({ where: { id: In(profileIds) } });
    const recipients = new Set(notifyIds);

    // Each recipient is told about the *other* profile, not their own.
    //
    // "Your interest was accepted" with nobody's name on it was the reported
    // defect: the reader had sent several and could not tell which one this
    // was. The counterpart is worked out per recipient rather than once,
    // because an agency running both sides of a pairing is a real case and
    // would otherwise be told about their own client.
    const byUser = new Map<string, string>();
    for (const profile of profiles) {
      if (!recipients.has(profile.id)) continue;
      const recipient = profile.userId ?? profile.managedByUserId;
      if (recipient) byUser.set(recipient, profile.id);
    }

    for (const [userId, ownProfileId] of byUser) {
      const other = profiles.find((p) => p.id !== ownProfileId) ?? null;
      const own = profiles.find((p) => p.id === ownProfileId) ?? null;
      await this.notifications.create(userId, type, {
        ...payload,
        // Enough to render the line and open the profile from it.
        counterpartProfileId: other?.id ?? null,
        counterpartName: other?.displayName ?? null,
        counterpartCity: other?.city ?? null,
        counterpartPhotoUrl: profilePhotoOf(other),
        // The reader's own side of the pairing, so an agent running many
        // profiles can tell which client the acceptance is for (EZ1-I80):
        // "Shravani accepted your interest in <subjectName>".
        subjectProfileId: ownProfileId,
        subjectName: own?.displayName ?? null,
        // Told as the steward of somebody else's profile — an agency or family
        // running an unclaimed one — rather than as its owner, so the line can
        // name whose profile it is instead of saying "your profile".
        forManagedProfile: own?.userId !== userId,
      });
    }
  }
}
