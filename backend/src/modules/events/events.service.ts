import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { PlanTask } from '../planner/entities/plan-task.entity';
import { In, Not, Repository } from 'typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { Profile } from '../users/entities/profile.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateEventDto,
  CreateGuestDto,
  EventQueryDto,
  GuestRsvpDto,
  UpdateGuestDto,
  UpdateEventDto,
  UpdateRsvpDto,
  SetWeddingInvitationCardDto,
} from './dto/event.dto';
import { WeddingInvitation } from './entities/wedding-invitation.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Quotation } from '../bookings/entities/quotation.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { User } from '../auth/entities/user.entity';
import { serviceNamesByIds } from '../catalog/service-names';
import { summariseQuotations } from '../bookings/booking-summary';
import {
  BookingStatus,
  EventStatus,
  NotificationType,
  ProviderType,
  RsvpStatus,
  UserRole,
} from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
import { expiresIn, generateToken, hashToken } from '../../common/util/tokens';
import { MatchmakingService } from '../matchmaking/matchmaking.service';

/** What a guest sees on the public RSVP page. */
export interface GuestRsvpView {
  guestName: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  status: RsvpStatus;
  seat: string | null;
  respondedAt: Date | null;
  /** What they said when they answered, so the page reads back their own reply. */
  attendingCount: number | null;
  declineReason: string | null;
  /** How many the invitation covers, which is what the head-count box defaults to. */
  invitedPartySize: number | null;
}

/**
 * The wedding invitation. A superset of the per-event view — `eventName`,
 * `eventDate` and `venue` summarise the first event — so a page written for
 * the per-event link still reads it.
 */
export interface WeddingRsvpView extends GuestRsvpView {
  kind: 'wedding';
  coupleNames: string | null;
  events: {
    name: string;
    category: string | null;
    eventDate: string | null;
    startTime: string | null;
    endTime: string | null;
    venue: string | null;
    venueAddress: string | null;
    city: string | null;
  }[];
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(WeddingPlan) private readonly plans: Repository<WeddingPlan>,
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(EventInvite) private readonly invites: Repository<EventInvite>,
    @InjectRepository(WeddingInvitation) private readonly weddingInvitations: Repository<WeddingInvitation>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlanTask) private readonly tasks: Repository<PlanTask>,
    // Read-only, to name a planner booked for a day, the service booked, the
    // price quoted, and a client with no profile.
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(VendorService) private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(Quotation) private readonly quotations: Repository<Quotation>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly cfg: AppConfigService,
    private readonly mail: MailService,
    private readonly moderation: ModerationService,
    private readonly notifications: NotificationsService,
    private readonly matchmaking: MatchmakingService,
  ) {}

  async createEvent(actor: AuthUser, dto: CreateEventDto) {
    this.assertTimeOrder(dto.startTime, dto.endTime);

    // An engaged planner may create the event on the couple's shared wedding
    // (EZ1-I144); resolveHost refuses a couple the planner is not engaged on.
    const { hostUserId, ...fields } = dto;
    const userId = await this.resolveHost(actor, hostUserId);

    // An event picture is shown to every guest who opens the invitation, so it
    // goes through the same check as a profile photograph.
    if (fields.imageUrl) {
      await this.moderation.assertGenuinePhoto(fields.imageUrl, {
        userId: actor.userId,
        kind: 'event',
      });
    }
    const saved = await this.events.save(this.events.create({ userId, ...fields }));
    // A function is one shared record between the couple and their engaged
    // planner (EZ1-I84). Whoever added it, tell the other side.
    await this.notifyEventSync(saved, actor.userId, ['a new function']);
    return saved;
  }

  /**
   * An evening that ends before it starts.
   *
   * The database refuses this too, and that check stays as the backstop — but
   * a constraint violation reaches the caller as a 500, which tells somebody
   * mistyping a time that the platform is broken. The rule belongs where it can
   * be explained.
   */
  private assertTimeOrder(start?: string | null, end?: string | null): void {
    if (!start || !end) return;
    if (end <= start) {
      throw new BadRequestException('The end time has to be after the start time');
    }
  }

  /**
   * The wedding, day by day.
   *
   * Filtering and searching happen here rather than in the client because the
   * list is the thing people scan, and a filter that only hides rows the
   * browser already has stops working the moment there are more days than one
   * page holds.
   */
  async listEvents(userId: string, q?: EventQueryDto) {
    const qb = this.events.createQueryBuilder('e').where('e."userId" = :userId', { userId });

    if (q?.status) qb.andWhere('e.status = :status', { status: q.status });
    if (q?.category) qb.andWhere('e.category = :category', { category: q.category });
    if (q?.q) {
      // Name, venue or city — the three things somebody remembers about a day
      // they are trying to find.
      qb.andWhere(
        '(LOWER(e.name) LIKE :term OR LOWER(COALESCE(e.venue, \'\')) LIKE :term OR LOWER(COALESCE(e.city, \'\')) LIKE :term)',
        { term: `%${q.q.toLowerCase()}%` },
      );
    }

    // Undated functions sort last rather than first: a day with no date yet is
    // the least urgent thing on the list, and NULLS FIRST puts it at the top.
    qb.orderBy('e."eventDate"', 'ASC', 'NULLS LAST').addOrderBy('e."startTime"', 'ASC', 'NULLS LAST');
    const rows = await qb.getMany();
    if (rows.length === 0) return rows;

    /*
     * RSVP counts on every day, not only the one that happens to be selected.
     *
     * "How many are coming to the sangeet" was answerable in exactly one place:
     * click the day, then read the panel. So the answer to "where are we with
     * the wedding" took as many clicks as there were days, and the page that
     * was supposed to summarise it summarised nothing.
     *
     * One query for every invitation across every day, counted in memory. The
     * alternative is a correlated subquery per event, which is the same work
     * done once per row.
     */
    const invites = await this.invites.find({ where: { eventId: In(rows.map((e) => e.id)) } });
    const byEvent = new Map<string, { coming: number; notComing: number; noReply: number }>();
    for (const event of rows) byEvent.set(event.id, { coming: 0, notComing: 0, noReply: 0 });

    for (const invite of invites) {
      const tally = byEvent.get(invite.eventId);
      if (!tally) continue;
      if (invite.status === RsvpStatus.ATTENDING) tally.coming += 1;
      else if (invite.status === RsvpStatus.DECLINED) tally.notComing += 1;
      // "Maybe" counts as not yet answered, because for a caterer it is.
      else tally.noReply += 1;
    }

    return rows.map((event) => ({ ...event, rsvp: byEvent.get(event.id) }));
  }

  /**
   * The counters above the list.
   *
   * Computed from the rows rather than maintained, so they cannot drift from
   * what the list below them shows — which is the failure that makes somebody
   * stop believing a summary.
   */
  async eventSummary(userId: string) {
    const rows = await this.events.find({ where: { userId } });
    const invites = rows.length
      ? await this.invites.find({ where: { eventId: In(rows.map((e) => e.id)) } })
      : [];

    const count = (status: EventStatus) => rows.filter((e) => e.status === status).length;
    return {
      total: rows.length,
      upcoming: count(EventStatus.UPCOMING),
      ongoing: count(EventStatus.ONGOING),
      completed: count(EventStatus.COMPLETED),
      cancelled: count(EventStatus.CANCELLED),
      /** Across every day — the number the caterer for the whole wedding asks for. */
      confirmedGuests: invites.filter((i) => i.status === RsvpStatus.ATTENDING).length,
      expectedGuests: rows.reduce((n, e) => n + (e.expectedGuests ?? 0), 0),
      budget: rows
        .reduce((n, e) => n + Number(e.budget ?? 0), 0)
        .toFixed(2),
    };
  }

  /**
   * Amend a function.
   *
   * Reachable by the couple and by the planner engaged on their wedding — one
   * record, two editors (see ownedEvent). Whatever one side changes on the
   * shared record, the other is told: the couple move a date or a guest count
   * and the planner hears; the planner changes how the day runs and the couple
   * hear (EZ1-I84).
   */
  async updateEvent(actor: AuthUser, eventId: string, dto: UpdateEventDto) {
    const event = await this.ownedEvent(actor.userId, eventId);
    this.assertTimeOrder(
      dto.startTime ?? event.startTime,
      dto.endTime ?? event.endTime,
    );
    const changed = this.changedSyncLabels(event, dto);
    Object.assign(event, dto);
    const saved = await this.events.save(event);
    await this.notifyEventSync(saved, actor.userId, changed);
    return saved;
  }

  /**
   * The fields on a shared event whose change is worth telling the other side
   * about, each with the word the notification uses for it. Grouped so the
   * three venue columns read as one change ("the venue"), not three.
   */
  private static readonly SYNC_FIELDS: { keys: (keyof UpdateEventDto)[]; label: string }[] = [
    { keys: ['name'], label: 'the name' },
    { keys: ['eventDate'], label: 'the date' },
    { keys: ['startTime', 'endTime'], label: 'the timing' },
    { keys: ['venue', 'venueAddress', 'city'], label: 'the venue' },
    { keys: ['expectedGuests'], label: 'the guest count' },
    { keys: ['budget'], label: 'the budget' },
    { keys: ['theme'], label: 'the theme' },
    { keys: ['specialRequirements'], label: 'the requirements' },
    { keys: ['description'], label: 'the details' },
    { keys: ['plannerNotes'], label: 'the planning notes' },
    { keys: ['status'], label: 'the status' },
  ];

  /** Which of the synced fields this update actually changes, as labels. */
  private changedSyncLabels(event: WeddingEvent, dto: UpdateEventDto): string[] {
    const before = event as unknown as Record<string, unknown>;
    return EventsService.SYNC_FIELDS.filter((f) =>
      f.keys.some(
        (k) =>
          dto[k] !== undefined && String(dto[k] ?? '') !== String(before[k as string] ?? ''),
      ),
    ).map((f) => f.label);
  }

  /**
   * Tell the other party to a shared event that it changed.
   *
   * Engagement is read from the wedding plan, the platform's one answer to "is
   * this planner working for this couple". With no planner engaged there is
   * nobody to sync to, and an edit by anyone other than the two parties (an
   * admin) notifies neither. Never allowed to fail the edit that triggered it —
   * the change is saved whether or not the feed is reachable.
   */
  private async notifyEventSync(
    event: WeddingEvent,
    editorUserId: string,
    changedLabels: string[],
  ): Promise<void> {
    if (changedLabels.length === 0) return;
    const plan = await this.plans.findOne({
      where: { userId: event.userId },
      order: { createdAt: 'DESC' },
    });
    const plannerUserId = plan?.plannerUserId ?? null;
    if (!plannerUserId) return;

    const editorIsHost = editorUserId === event.userId;
    if (!editorIsHost && editorUserId !== plannerUserId) return;

    const recipient = editorIsHost ? plannerUserId : event.userId;
    const type = editorIsHost
      ? NotificationType.EVENT_CHANGED_BY_COUPLE
      : NotificationType.EVENT_CHANGED_BY_PLANNER;

    try {
      await this.notifications.create(recipient, type, {
        eventId: event.id,
        eventName: event.name,
        hostUserId: event.userId,
        changed: changedLabels.join(', '),
      });
    } catch {
      // A wedding edit must not fail because the notification could not be
      // written. The shared record is already saved.
    }
  }

  /**
   * Removes an event.
   *
   * Refused while vendors are booked against it. Deleting the mehendi out from
   * under a confirmed makeup artist would leave a live booking pointing at
   * nothing, and the couple would find out when somebody failed to arrive.
   */
  async removeEvent(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);

    const booked = await this.bookings.count({
      where: { eventId, status: Not(BookingStatus.CANCELLED) },
    });
    if (booked > 0) {
      throw new BadRequestException(
        'Cancel the vendors booked for this event before removing it',
      );
    }

    await this.invites.delete({ eventId });
    await this.events.delete({ id: eventId });
    return { success: true };
  }

  /** Who is booked for this event, so the couple can see the day as a whole. */
  async eventVendors(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);
    return this.vendorRowsForEvent(eventId);
  }

  /**
   * The bookings placed against one event, named. Vendors the couple booked
   * before hiring a planner show up here as the day's providers — one record,
   * so the planner sees what is already arranged rather than a blank slate
   * (EZ1-I84). Permission is the caller's to check; this only reads.
   */
  private async vendorRowsForEvent(eventId: string) {
    const bookings = await this.bookings.find({
      where: { eventId },
      order: { createdAt: 'DESC' },
    });
    if (bookings.length === 0) return [];

    // A planner booked against the day is a provider too: reading vendors
    // alone named every planner "Provider", with no category and no service.
    const idsOf = (type: ProviderType) => [
      ...new Set(bookings.filter((b) => b.providerType === type).map((b) => b.providerId)),
    ];
    const vendorIds = idsOf(ProviderType.VENDOR);
    const plannerIds = idsOf(ProviderType.PLANNER);
    const [vendors, planners, serviceNames, quotes] = await Promise.all([
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      plannerIds.length
        ? this.planners.find({ where: { id: In(plannerIds) } })
        : Promise.resolve([]),
      serviceNamesByIds(this.vendorServices, bookings.map((b) => b.vendorServiceId)),
      this.quotations.find({ where: { bookingId: In(bookings.map((b) => b.id)) } }),
    ]);
    const byId = new Map(vendors.map((v) => [v.id, v]));
    const plannerById = new Map(planners.map((p) => [p.id, p]));

    return bookings.map((b) => {
      const isPlanner = b.providerType === ProviderType.PLANNER;
      // The newest quotation and where it stands. `amount` stays the agreed
      // total, which is 0.00 until a quotation is accepted.
      const quotation = summariseQuotations(quotes.filter((q) => q.bookingId === b.id));
      return {
        bookingId: b.id,
        status: b.status,
        amount: b.amount,
        currency: b.currency,
        quotation,
        quotedAmount: quotation?.amount ?? null,
        providerId: b.providerId,
        providerType: b.providerType,
        providerName:
          (isPlanner ? plannerById.get(b.providerId)?.agencyName : byId.get(b.providerId)?.name) ??
          'Provider',
        category: isPlanner ? 'Wedding planner' : (byId.get(b.providerId)?.category ?? null),
        serviceName: b.vendorServiceId
          ? (serviceNames.get(b.vendorServiceId) ?? null)
          : isPlanner
            ? 'Wedding planning'
            : null,
      };
    });
  }

  /**
   * One shared event, everything about it, on one screen (EZ1-I84).
   *
   * The couple's Events page and the planner's workspace open the same record
   * through this — vendors, guests, tasks, budget and notes for a single day —
   * so neither side is looking at a copy. Reuses the couple's own guest/RSVP
   * data (no second guest list) and the wedding plan's tasks (no second task
   * list). Reachable by the host and by the planner engaged on the wedding;
   * ownedEvent refuses anyone else.
   */
  async eventWorkspace(userId: string, eventId: string) {
    const event = await this.ownedEvent(userId, eventId);

    const [vendors, invites, plan] = await Promise.all([
      this.vendorRowsForEvent(eventId),
      this.invites.find({ where: { eventId } }),
      this.plans.findOne({ where: { userId: event.userId }, order: { createdAt: 'DESC' } }),
    ]);
    const [guests, tasks] = await Promise.all([
      this.guestsFor(invites),
      plan
        ? this.tasks.find({ where: { planId: plan.id }, order: { dueDate: 'ASC' } })
        : Promise.resolve([]),
    ]);

    // The day's own budget against what its bookings actually came to. A
    // cancelled booking is not a commitment.
    const committed = vendors
      .filter((v) => v.status !== BookingStatus.CANCELLED)
      .reduce((n, v) => n + Number(v.amount ?? 0), 0);
    // What is quoted but not yet agreed: live bookings whose total is still
    // 0.00 while a quotation holds a price. Kept apart from `committed`, which
    // stays what has actually been agreed.
    const quoted = vendors
      .filter((v) => v.status !== BookingStatus.CANCELLED && !Number(v.amount ?? 0))
      .reduce((n, v) => n + Number(v.quotedAmount ?? 0), 0);
    const budgeted = Number(event.budget ?? 0);

    const attending = invites.filter((i) => i.status === RsvpStatus.ATTENDING);
    return {
      event: {
        id: event.id,
        userId: event.userId,
        name: event.name,
        eventType: event.eventType,
        category: event.category,
        eventDate: event.eventDate,
        startTime: event.startTime,
        endTime: event.endTime,
        venue: event.venue ?? null,
        venueAddress: event.venueAddress,
        city: event.city,
        expectedGuests: event.expectedGuests,
        budget: event.budget,
        status: event.status,
      },
      plannerEngaged: Boolean(plan?.plannerUserId),
      vendors,
      guests: {
        summary: {
          onList: invites.length,
          attending: attending.length,
          declined: invites.filter((i) => i.status === RsvpStatus.DECLINED).length,
          maybe: invites.filter((i) => i.status === RsvpStatus.MAYBE).length,
          awaiting: invites.filter((i) => i.status === RsvpStatus.INVITED).length,
          expectedHeadcount: attending.reduce(
            (n, i) => n + (i.attendingCount ?? guests.get(i.guestId)?.partySize ?? 1),
            0,
          ),
        },
        rows: invites.map((i) => ({
          inviteId: i.id,
          name: guests.get(i.guestId)?.name ?? 'Guest',
          status: i.status,
          attendingCount: i.attendingCount,
          invitedPartySize: guests.get(i.guestId)?.partySize ?? null,
        })),
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        dueDate: t.dueDate,
        status: t.status,
      })),
      budget: {
        budgeted: budgeted.toFixed(2),
        committed: committed.toFixed(2),
        quoted: quoted.toFixed(2),
        remaining: (budgeted - committed).toFixed(2),
        overBudget: committed > budgeted && budgeted > 0,
      },
      notes: {
        theme: event.theme,
        specialRequirements: event.specialRequirements,
        plannerNotes: event.plannerNotes,
        description: event.description,
      },
    };
  }

  async addGuest(userId: string, dto: CreateGuestDto) {
    return this.withoutToken(await this.guests.save(this.guests.create({ userId, ...dto, contact: '' })));
  }

  async weddingInvitation(userId: string) {
    return (await this.weddingInvitations.findOne({ where: { userId } })) ?? { cardUrl: null };
  }

  async setWeddingInvitationCard(userId: string, dto: SetWeddingInvitationCardDto) {
    const current = await this.weddingInvitations.findOne({ where: { userId } });
    if (current) {
      current.cardUrl = dto.cardUrl;
      return this.weddingInvitations.save(current);
    }
    return this.weddingInvitations.save(this.weddingInvitations.create({ userId, cardUrl: dto.cardUrl }));
  }

  async removeWeddingInvitationCard(userId: string) {
    const current = await this.weddingInvitations.findOne({ where: { userId } });
    if (!current) return { cardUrl: null };
    current.cardUrl = null;
    return this.weddingInvitations.save(current);
  }

  /**
   * Correcting a guest record.
   *
   * Worth having on its own because the head count and the mobile number are
   * exactly the two things that turn out to be wrong on the day somebody starts
   * chasing RSVPs, and re-creating the guest would lose their invitation.
   */
  async updateGuest(userId: string, guestId: string, dto: UpdateGuestDto) {
    const guest = await this.ownedGuest(userId, guestId);
    Object.assign(guest, dto);
    return this.withoutToken(await this.guests.save(guest));
  }

  /**
   * The guest list, each guest with the events they are invited to, so the
   * host can see (and choose) what a wedding invitation will cover.
   */
  async listGuests(userId: string) {
    const guests = await this.guests.find({ where: { userId }, order: { createdAt: 'DESC' } });
    if (guests.length === 0) return [];
    const invites = await this.invites.find({ where: { guestId: In(guests.map((g) => g.id)) } });
    const byGuest = new Map<string, string[]>();
    for (const invite of invites) {
      byGuest.set(invite.guestId, [...(byGuest.get(invite.guestId) ?? []), invite.eventId]);
    }
    return guests.map((guest) => ({ ...guest, invitedEventIds: byGuest.get(guest.id) ?? [] }));
  }

  /** Loads an event only if the caller is the host. */
  /**
   * The couples this planner was hired by.
   *
   * Read from the wedding plans they are engaged on rather than from bookings
   * directly, because engagement is already a decision the platform makes —
   * engagePlanner only sets plannerUserId against a confirmed or completed
   * booking — and a second definition of "my clients" would eventually
   * disagree with the first.
   */
  async engagedHosts(plannerUserId: string): Promise<{ userId: string; name: string }[]> {
    const plans = await this.plans.find({ where: { plannerUserId } });
    if (plans.length === 0) return [];

    const hostIds = [...new Set(plans.map((p) => p.userId))];
    const [profiles, users] = await Promise.all([
      this.profiles.find({ where: { userId: In(hostIds) } }),
      this.users.find({ where: { id: In(hostIds) }, select: ['id', 'email'] }),
    ]);
    const nameByUser = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const emailByUser = new Map(users.map((u) => [u.id, u.email]));

    return hostIds.map((userId) => ({
      userId,
      // A couple with no profile yet is still somebody the planner can name.
      name: nameByUser.get(userId) ?? emailByUser.get(userId) ?? 'A client',
    }));
  }

  /**
   * Whose events these are, allowing for somebody working on them.
   *
   * Returns the user whose events should be read. A host is always themselves;
   * a planner may name a host they are engaged on, and is refused otherwise.
   * Everything downstream stays keyed to one userId, which is what keeps this
   * from becoming a second permission system.
   */
  async resolveHost(actor: AuthUser, requestedHostId?: string): Promise<string> {
    if (!requestedHostId || requestedHostId === actor.userId) return actor.userId;

    const engaged = await this.plans.findOne({
      where: { userId: requestedHostId, plannerUserId: actor.userId },
    });
    if (!engaged && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You are not engaged on that wedding');
    }
    return requestedHostId;
  }

  /**
   * Loads an event the caller may work on.
   *
   * The host, and the planner they hired. A planner who has been engaged is
   * running these days — booking the vendors, chasing the guest list — and
   * asking them to do it through somebody else's login was the reason the
   * Events page was empty for them.
   */
  private async ownedEvent(userId: string, eventId: string): Promise<WeddingEvent> {
    const event = await this.events.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.userId === userId) return event;

    const engaged = await this.plans.findOne({
      where: { userId: event.userId, plannerUserId: userId },
    });
    if (!engaged) throw new ForbiddenException('This is not your event');
    return event;
  }

  /** Loads a guest only if the caller added them. */
  private async ownedGuest(userId: string, guestId: string): Promise<Guest> {
    const guest = await this.guests.findOne({ where: { id: guestId } });
    if (!guest) throw new NotFoundException('Guest not found');
    if (guest.userId !== userId) throw new ForbiddenException('This is not your guest');
    return guest;
  }

  /**
   * Invites a guest and issues their personal RSVP link.
   *
   * Guests are not platform users, so they answer through a signed, single-use
   * token rather than an authenticated route. The plaintext token is returned
   * to the host (so they can share it by hand) and emailed when the guest has
   * an email address on file; only its hash is stored.
   */
  async invite(userId: string, eventId: string, guestId: string) {
    const event = await this.ownedEvent(userId, eventId);
    const guest = await this.ownedGuest(userId, guestId);

    let invite = await this.invites.findOne({ where: { eventId, guestId } });
    if (!invite) {
      invite = this.invites.create({ eventId, guestId, status: RsvpStatus.INVITED });
    }

    const { token, tokenHash } = generateToken();
    invite.rsvpTokenHash = tokenHash;
    invite.rsvpTokenExpiresAt = expiresIn(this.cfg.auth.rsvpTokenTtlDays * 86_400);
    const saved = await this.invites.save(invite);

    if (guest.contact && guest.contact.includes('@')) {
      const hostProfile = await this.profiles.findOne({ where: { userId } });
      await this.mail.sendRsvpInvitation({
        to: guest.contact,
        guestName: guest.name,
        eventName: event.name,
        hostName: hostProfile?.displayName ?? 'Your host',
        token,
      });
    }

    return { invite: saved, rsvpToken: token, rsvpUrl: `/rsvp/${token}` };
  }

  /**
   * Invites a guest to the wedding with one personal link.
   *
   * The token lives on the guest row and resolves to the events this guest is
   * invited to, so there is one link and one answer rather than one per
   * function. Which events those are is the host's choice (`eventIds`), or,
   * without one, the per-event invites the guest already has: a reception-only
   * guest is never shown the address of a private family function, nor counted
   * on its guest list. Sending again rotates the token — the old link stops
   * working — and keeps any answer already given.
   */
  async inviteToWedding(userId: string, guestId: string, eventIds?: string[]) {
    const guest = await this.ownedGuest(userId, guestId);
    if (eventIds && eventIds.length > 0) {
      const wanted = new Set(eventIds);
      const chosen = (await this.weddingEvents(userId)).filter((e) => wanted.has(e.id));
      if (chosen.length !== wanted.size) {
        throw new BadRequestException('Choose events from your own wedding that are not cancelled');
      }
      await this.ensureEventInvites(guest, chosen);
    }
    const events = await this.invitedEvents(guest);
    if (events.length === 0) {
      throw new BadRequestException('Choose the events this invitation covers');
    }

    const { token, tokenHash } = generateToken();
    guest.rsvpTokenHash = tokenHash;
    guest.rsvpTokenExpiresAt = expiresIn(this.cfg.auth.rsvpTokenTtlDays * 86_400);
    guest.rsvpStatus = guest.rsvpStatus ?? RsvpStatus.INVITED;
    await this.guests.save(guest);
    await this.syncEventInvites(guest, events);

    if (guest.contact && guest.contact.includes('@')) {
      const couple = await this.coupleNames(userId);
      await this.mail.sendRsvpInvitation({
        to: guest.contact,
        guestName: guest.name,
        eventName: couple ? `the wedding of ${couple}` : 'our wedding',
        hostName: couple ?? 'Your hosts',
        token,
      });
    }

    return { guest: this.withoutToken(guest), rsvpToken: token, rsvpUrl: `/rsvp/${token}` };
  }

  /** Host records the guest's wedding reply for them — they answered by phone. */
  async respondForGuest(userId: string, guestId: string, dto: GuestRsvpDto) {
    const guest = await this.ownedGuest(userId, guestId);
    await this.applyWeddingRsvp(guest, dto);
    return this.withoutToken(guest);
  }

  /** A save reloads every column, the token hash included; it never goes back out. */
  private withoutToken(guest: Guest) {
    const { rsvpTokenHash, ...rest } = guest;
    void rsvpTokenHash;
    return rest;
  }

  /** The host's events that are still going ahead, in date order. */
  private weddingEvents(hostId: string): Promise<WeddingEvent[]> {
    return this.events.find({
      where: { userId: hostId, status: Not(EventStatus.CANCELLED) },
      order: { eventDate: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * The events a guest's wedding invitation covers: the host's events, not
   * cancelled, that this guest has a per-event invite for. Nothing else is
   * ever shown on their RSVP page or answered by their reply.
   */
  private async invitedEvents(guest: Guest): Promise<WeddingEvent[]> {
    const invites = await this.invites.find({ where: { guestId: guest.id } });
    if (invites.length === 0) return [];
    return this.events.find({
      where: {
        id: In(invites.map((i) => i.eventId)),
        userId: guest.userId,
        status: Not(EventStatus.CANCELLED),
      },
      order: { eventDate: 'ASC', startTime: 'ASC' },
    });
  }

  /** A per-event invite on each chosen event, leaving any that exist as they are. */
  private async ensureEventInvites(guest: Guest, events: WeddingEvent[]): Promise<void> {
    const existing = await this.invites.find({
      where: { guestId: guest.id, eventId: In(events.map((e) => e.id)) },
    });
    const have = new Set(existing.map((i) => i.eventId));
    const missing = events
      .filter((e) => !have.has(e.id))
      .map((e) => this.invites.create({ eventId: e.id, guestId: guest.id, status: RsvpStatus.INVITED }));
    if (missing.length > 0) await this.invites.save(missing);
  }

  /** "Priya & Arjun": the host and their match-fixed partner, where known. */
  private async coupleNames(hostId: string): Promise<string | null> {
    const partnerId = await this.matchmaking.fixedPartnerUserId(hostId);
    const ids = partnerId ? [hostId, partnerId] : [hostId];
    const rows = await this.profiles.find({ where: { userId: In(ids) } });
    const names = ids
      .map((id) => rows.find((p) => p.userId === id)?.displayName)
      .filter((n): n is string => !!n);
    return names.length ? names.join(' & ') : null;
  }

  /**
   * Carries the wedding answer onto the guest's per-event invites.
   *
   * Only onto invites that were never answered on their own. A guest who said
   * "attending" to the wedding and later declined the Haldi through its own
   * link, or whose Haldi reply the host recorded by hand, keeps that answer:
   * the wedding reply is the default for each event, not an override of one
   * given for that event specifically.
   */
  private async syncEventInvites(guest: Guest, events: WeddingEvent[]): Promise<void> {
    if (!guest.rsvpStatus || guest.rsvpStatus === RsvpStatus.INVITED || events.length === 0) return;
    const rows = await this.invites.find({
      where: { guestId: guest.id, eventId: In(events.map((e) => e.id)) },
    });
    const followers = rows.filter((row) => !row.answeredIndividually);
    for (const row of followers) {
      row.status = guest.rsvpStatus;
      row.respondedAt = guest.respondedAt;
      row.attendingCount = guest.attendingCount;
      row.declineReason = guest.declineReason;
    }
    if (followers.length > 0) await this.invites.save(followers);
  }

  private async applyWeddingRsvp(guest: Guest, dto: GuestRsvpDto): Promise<void> {
    const answer = {
      status: guest.rsvpStatus ?? RsvpStatus.INVITED,
      respondedAt: guest.respondedAt,
      attendingCount: guest.attendingCount,
      declineReason: guest.declineReason,
    } as EventInvite;
    this.applyRsvp(answer, dto.status, dto.attendingCount, dto.declineReason);
    guest.rsvpStatus = answer.status;
    guest.respondedAt = answer.respondedAt;
    guest.attendingCount = answer.attendingCount;
    guest.declineReason = answer.declineReason;
    await this.guests.save(guest);
    await this.syncEventInvites(guest, await this.invitedEvents(guest));
  }

  /** The guest a wedding token belongs to, or null when it is not one. */
  private async guestByToken(token: string): Promise<Guest | null> {
    const guest = await this.guests.findOne({ where: { rsvpTokenHash: hashToken(token) } });
    if (!guest) return null;
    if (guest.rsvpTokenExpiresAt && guest.rsvpTokenExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That invitation link has expired');
    }
    return guest;
  }

  /**
   * Public: the wedding invitation. Only what an invitation carries — who,
   * which of the events they are invited to, when and where — never the
   * budget, other guests, replies, or any event they were not asked to.
   */
  private async weddingView(guest: Guest): Promise<WeddingRsvpView> {
    const [events, coupleNames] = await Promise.all([
      this.invitedEvents(guest),
      this.coupleNames(guest.userId),
    ]);
    const first = events[0];
    return {
      kind: 'wedding',
      coupleNames,
      guestName: guest.name,
      eventName: coupleNames ? `The wedding of ${coupleNames}` : 'Our wedding',
      eventDate: first?.eventDate ?? null,
      venue: first?.venue ?? null,
      status: guest.rsvpStatus ?? RsvpStatus.INVITED,
      seat: null,
      respondedAt: guest.respondedAt,
      attendingCount: guest.attendingCount,
      declineReason: guest.declineReason,
      invitedPartySize: guest.partySize,
      events: events.map((e) => ({
        name: e.name,
        category: e.category ?? null,
        eventDate: e.eventDate ?? null,
        startTime: e.startTime ?? null,
        endTime: e.endTime ?? null,
        venue: e.venue ?? null,
        venueAddress: e.venueAddress ?? null,
        city: e.city ?? null,
      })),
    };
  }

  /**
   * Host-side RSVP override, for when a guest replies by phone. The guest-facing
   * path is `respondByToken` below.
   */
  async updateRsvp(userId: string, inviteId: string, dto: UpdateRsvpDto) {
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.ownedEvent(userId, invite.eventId);

    this.applyRsvp(invite, dto.status, dto.attendingCount, dto.declineReason);
    // An answer for this event specifically: a later wedding-level reply leaves it alone.
    invite.answeredIndividually = true;
    if (dto.seat !== undefined) invite.seat = dto.seat;
    return this.invites.save(invite);
  }

  /**
   * Mints (or re-mints) the link for an event.
   *
   * Re-minting invalidates the old one, which is the only way to withdraw an
   * invitation that has gone somewhere it should not have. Anybody already in
   * the guest list keeps their own per-guest token — those are addressed to a
   * person and are not affected by rotating the open one.
   */
  async createShareLink(userId: string, eventId: string): Promise<{ token: string; url: string }> {
    const event = await this.ownedEvent(userId, eventId);
    const { token, tokenHash } = generateToken();
    event.shareTokenHash = tokenHash;
    event.shareTokenCreatedAt = new Date();
    await this.events.save(event);
    /*
     * The whole address, built here rather than in the browser.
     *
     * This returned a bare token and the page pasted it onto
     * `window.location.origin`, so the host was handed a link to whatever
     * address they happened to be viewing the portal on — `localhost:8080` on
     * a dev machine, which is a guest's own phone when they tap it, and is
     * why a forwarded invitation opened as "not available" (EZ1-I178).
     *
     * A build-time `VITE_APP_BASE_URL` was tried first and cannot work: Vite
     * inlines it at image-build time, nothing supplies it, and it collapsed
     * back to the origin in every build. APP_BASE_URL is a runtime variable
     * the config schema already validates, and it is what `/invite/:token`
     * and the RSVP links have always been built from — so one setting now
     * governs every link the platform hands out.
     */
    const base = this.cfg.mail.appBaseUrl.replace(/\/+$/, '');
    return { token, url: `${base}/invitation/${token}` };
  }

  /** Stops the link working, without touching the guests who used it. */
  async revokeShareLink(userId: string, eventId: string): Promise<void> {
    const event = await this.ownedEvent(userId, eventId);
    event.shareTokenHash = null;
    event.shareTokenCreatedAt = null;
    await this.events.save(event);
  }

  private async eventByShareToken(token: string): Promise<WeddingEvent> {
    const event = await this.events.findOne({ where: { shareTokenHash: hashToken(token) } });
    if (!event) throw new NotFoundException('That invitation link is not valid');
    return event;
  }

  /**
   * Public: the invitation, for anybody holding the link.
   *
   * Deliberately thin. This is reachable by whoever the link reached, so it
   * carries what an invitation carries — which day, when, where — and nothing
   * about the household, the other guests, or who else has replied.
   */
  async previewShared(token: string) {
    const event = await this.eventByShareToken(token);
    const host = await this.profiles.findOne({ where: { userId: event.userId } });
    const invitation = await this.weddingInvitations.findOne({ where: { userId: event.userId } });
    return {
      eventName: event.name,
      eventDate: event.eventDate ?? null,
      startTime: event.startTime ?? null,
      venue: event.venue ?? null,
      venueAddress: event.venueAddress ?? null,
      city: event.city ?? null,
      hostName: host?.displayName ?? 'Your hosts',
      cardUrl: invitation?.cardUrl ?? null,
    };
  }

  /**
   * Public: somebody answers the invitation.
   *
   * The reply creates the guest, because the host has no list yet — that is
   * what they are building. Answering twice under the same name updates the
   * first answer rather than adding a second: people change their minds, and
   * a guest list that counts them twice is worse than one that lets them.
   */
  async respondShared(
    token: string,
    dto: {
      name: string;
      contact?: string;
      status?: RsvpStatus.ATTENDING | RsvpStatus.MAYBE | RsvpStatus.DECLINED;
      attending?: boolean;
      partySize?: number;
    },
  ) {
    const event = await this.eventByShareToken(token);

    const name = dto.name.trim();
    // Matched on the name within this host's guests: a wedding does not have
    // two Ramesh Sharmas often enough to justify making everybody type an
    // email, and the host can merge duplicates from the guest list.
    let guest = await this.guests.findOne({ where: { userId: event.userId, name } });
    if (!guest) {
      guest = await this.guests.save(
        this.guests.create({
          userId: event.userId,
          name,
          contact: dto.contact?.trim() ?? '',
          partySize: dto.partySize ?? null,
          relation: null,
        }),
      );
    }

    let invite = await this.invites.findOne({ where: { eventId: event.id, guestId: guest.id } });
    if (!invite) {
      invite = this.invites.create({ eventId: event.id, guestId: guest.id });
    }
    // Older public links sent a boolean. Keep accepting it while new links can
    // record a useful tentative answer as well.
    // The direct link is registration, not an attendance question. A guest
    // who merely registers stays pending until the host records an RSVP.
    const status = dto.status ?? (dto.attending === undefined ? RsvpStatus.INVITED : dto.attending ? RsvpStatus.ATTENDING : RsvpStatus.DECLINED);
    invite.status = status;
    invite.attendingCount = status === RsvpStatus.ATTENDING ? (dto.partySize ?? 1) : null;
    invite.respondedAt = new Date();
    invite.answeredIndividually = true;
    await this.invites.save(invite);

    return { recorded: true, status, name: guest.name };
  }

  private async inviteByToken(token: string): Promise<EventInvite> {
    const invite = await this.invites.findOne({ where: { rsvpTokenHash: hashToken(token) } });
    if (!invite) throw new NotFoundException('That invitation link is not valid');
    if (invite.rsvpTokenExpiresAt && invite.rsvpTokenExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That invitation link has expired');
    }
    return invite;
  }

  /** Public: what the guest sees before answering. */
  async previewByToken(token: string): Promise<GuestRsvpView | WeddingRsvpView> {
    const invited = await this.guestByToken(token);
    if (invited) return this.weddingView(invited);

    const invite = await this.inviteByToken(token);
    const [event, guest] = await Promise.all([
      this.events.findOne({ where: { id: invite.eventId } }),
      this.guests.findOne({ where: { id: invite.guestId } }),
    ]);
    if (!event || !guest) throw new NotFoundException('That invitation is no longer valid');

    return {
      guestName: guest.name,
      eventName: event.name,
      eventDate: event.eventDate ?? null,
      venue: event.venue ?? null,
      status: invite.status,
      seat: invite.seat ?? null,
      respondedAt: invite.respondedAt,
      attendingCount: invite.attendingCount,
      declineReason: invite.declineReason,
      invitedPartySize: guest.partySize,
    };
  }

  /**
   * Public: the guest answers.
   *
   * The token stays valid until it expires so a guest can change their mind,
   * but it only ever addresses their own invite — it carries no authority over
   * the event or any other guest.
   */
  async respondByToken(
    token: string,
    dto: GuestRsvpDto,
  ): Promise<GuestRsvpView | WeddingRsvpView> {
    const guest = await this.guestByToken(token);
    if (guest) {
      await this.applyWeddingRsvp(guest, dto);
      return this.weddingView(guest);
    }

    const invite = await this.inviteByToken(token);
    this.applyRsvp(invite, dto.status, dto.attendingCount, dto.declineReason);
    invite.answeredIndividually = true;
    await this.invites.save(invite);
    return this.previewByToken(token);
  }

  /**
   * The one place an RSVP is written, wherever it came from.
   *
   * Two rules that are easy to get wrong separately and impossible to get wrong
   * here: a refusal carries no head count, and changing your mind from "not
   * coming" back to "coming" clears the reason you gave for the refusal — it is
   * no longer true, and leaving it on the record makes the organiser's list
   * read as though it still is.
   */
  private applyRsvp(
    invite: EventInvite,
    status: RsvpStatus,
    attendingCount?: number,
    declineReason?: string,
  ): void {
    invite.status = status;
    invite.respondedAt = new Date();

    if (status === RsvpStatus.DECLINED) {
      invite.attendingCount = 0;
      if (declineReason !== undefined) invite.declineReason = declineReason || null;
    } else {
      invite.declineReason = null;
      if (attendingCount !== undefined) invite.attendingCount = attendingCount;
    }
  }

  /** RSVP + seating summary for an event the caller hosts. */
  async guestList(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);
    const invites = await this.invites.find({ where: { eventId } });
    const summary = {
      total: invites.length,
      attending: invites.filter((i) => i.status === RsvpStatus.ATTENDING).length,
      declined: invites.filter((i) => i.status === RsvpStatus.DECLINED).length,
      maybe: invites.filter((i) => i.status === RsvpStatus.MAYBE).length,
      pending: invites.filter((i) => i.status === RsvpStatus.INVITED).length,
    };
    // Never leak the token hashes to the client.
    const rows = invites.map(({ rsvpTokenHash, ...rest }) => {
      void rsvpTokenHash;
      return rest;
    });
    return { summary, invites: rows };
  }

  // ------------------------------------------------------------------ RSVP

  /**
   * The numbers an organiser plans from.
   *
   * Two head counts, not one. `invitations` is how many invitations are in each
   * state; `people` is how many human beings that comes to, because an
   * invitation goes to a family and the caterer counts heads. The gap between
   * invited and attending is the thing worth chasing.
   *
   * "Maybe" is reported on its own rather than folded into either side.
   * Somebody who answered "probably" has answered, and counting them as
   * unresponsive sends them a reminder they have already replied to.
   */
  async rsvpDashboard(userId: string, eventId: string) {
    const event = await this.ownedEvent(userId, eventId);
    const invites = await this.invites.find({ where: { eventId } });
    const guests = await this.guestsFor(invites);

    // How many people an invitation covers: what they said when they answered,
    // otherwise how many were invited, otherwise one.
    const heads = (i: EventInvite) =>
      i.attendingCount ?? guests.get(i.guestId)?.partySize ?? 1;
    const sum = (rows: EventInvite[]) => rows.reduce((n, i) => n + heads(i), 0);

    const of = (status: RsvpStatus) => invites.filter((i) => i.status === status);
    const coming = of(RsvpStatus.ATTENDING);
    const notComing = of(RsvpStatus.DECLINED);
    const maybe = of(RsvpStatus.MAYBE);
    const notResponded = of(RsvpStatus.INVITED);

    const WEEK = 7 * 24 * 60 * 60 * 1000;

    return {
      event: { id: event.id, name: event.name, eventDate: event.eventDate, venue: event.venue },
      totalInvited: invites.length,
      totalInvitedHeadcount: invites.reduce(
        (n, i) => n + (guests.get(i.guestId)?.partySize ?? 1),
        0,
      ),
      /*
       * Keyed the way `GET :id/rsvp/:category` accepts, and it did not used to
       * be: this returned `notComing` and `notResponded` while the route one
       * method below demanded `not_coming` and `not_responded`. A client
       * cannot satisfy both, and the one we have picked the route's spelling —
       * so every read of the declined and unanswered buckets found undefined
       * and took the events screen down. Two names for four categories, one
       * method apart, is the defect; the client was right.
       */
      categories: {
        coming: { invitations: coming.length, people: sum(coming) },
        // Nobody is coming from a refusal, whatever the family size.
        not_coming: { invitations: notComing.length, people: 0 },
        maybe: { invitations: maybe.length, people: sum(maybe) },
        not_responded: { invitations: notResponded.length, people: sum(notResponded) },
      },
      /** Not chased yet, or not for a week. */
      awaitingReminder: notResponded.filter(
        (i) => !i.lastRemindedAt || Date.now() - i.lastRemindedAt.getTime() > WEEK,
      ).length,
    };
  }

  /**
   * The guests behind one number on the dashboard.
   *
   * Every category returns the same row shape, carrying the fields that
   * category's follow-up needs: a head count for the people coming, a reason
   * for those who cannot, and a last-reminded date for those who have not said
   * — because the point of a "not responded" list is knowing who has already
   * been asked twice.
   */
  async rsvpGuests(userId: string, eventId: string, category: string) {
    await this.ownedEvent(userId, eventId);

    const wanted: Record<string, RsvpStatus | null> = {
      coming: RsvpStatus.ATTENDING,
      not_coming: RsvpStatus.DECLINED,
      maybe: RsvpStatus.MAYBE,
      not_responded: RsvpStatus.INVITED,
      all: null,
    };
    if (!(category in wanted)) {
      throw new BadRequestException(
        'Ask for coming, not_coming, maybe, not_responded or all',
      );
    }
    const status = wanted[category];

    const invites = await this.invites.find({
      where: status === null ? { eventId } : { eventId, status },
      order: { updatedAt: 'DESC' },
    });
    const guests = await this.guestsFor(invites);

    return invites.map((invite) => {
      const guest = guests.get(invite.guestId);
      return {
        inviteId: invite.id,
        guestId: invite.guestId,
        name: guest?.name ?? 'Guest',
        phone: guest?.phone ?? null,
        email: guest?.contact ?? null,
        relation: guest?.relation ?? null,
        invitedPartySize: guest?.partySize ?? null,
        status: invite.status,
        attendingCount: invite.attendingCount,
        respondedAt: invite.respondedAt,
        declineReason: invite.declineReason,
        // Whether the invitation ever actually went out, which is a different
        // question from whether they answered it.
        invitationSent: invite.rsvpTokenHash !== null,
        lastRemindedAt: invite.lastRemindedAt,
        reminderCount: invite.reminderCount,
        seat: invite.seat,
      };
    });
  }

  /**
   * Records that somebody has been chased.
   *
   * The reminder only goes out by email if there is an address; the record is
   * kept either way, because an organiser who rang them still needs the list to
   * say so. A fresh token is issued with it, since the plaintext one only ever
   * existed inside the original invitation.
   */
  async remind(userId: string, inviteId: string) {
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    const event = await this.ownedEvent(userId, invite.eventId);

    if (invite.status !== RsvpStatus.INVITED) {
      throw new BadRequestException('They have already answered');
    }

    const guest = await this.guests.findOne({ where: { id: invite.guestId } });
    invite.lastRemindedAt = new Date();
    invite.reminderCount += 1;

    let emailSent = false;
    if (guest?.contact && guest.contact.includes('@')) {
      const { token, tokenHash } = generateToken();
      invite.rsvpTokenHash = tokenHash;
      invite.rsvpTokenExpiresAt = expiresIn(this.cfg.auth.rsvpTokenTtlDays * 86_400);
      const hostProfile = await this.profiles.findOne({ where: { userId } });
      await this.mail.sendRsvpInvitation({
        to: guest.contact,
        guestName: guest.name,
        eventName: event.name,
        hostName: hostProfile?.displayName ?? 'Your host',
        token,
      });
      emailSent = true;
    }

    const saved = await this.invites.save(invite);
    return {
      inviteId: saved.id,
      lastRemindedAt: saved.lastRemindedAt,
      reminderCount: saved.reminderCount,
      emailSent,
    };
  }

  private async guestsFor(invites: EventInvite[]): Promise<Map<string, Guest>> {
    if (invites.length === 0) return new Map();
    const rows = await this.guests.find({ where: { id: In(invites.map((i) => i.guestId)) } });
    return new Map(rows.map((g) => [g.id, g]));
  }
}
