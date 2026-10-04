import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { WeddingDashboardService } from './wedding-dashboard.service';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Quotation } from '../bookings/entities/quotation.entity';
import { summariseQuotations } from '../bookings/booking-summary';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { serviceNamesByIds } from '../catalog/service-names';
import { WeddingFacts, bookingContextOf, weddingContextOf } from '../bookings/booking-venue';
import { loadWeddingFacts } from '../bookings/wedding-facts';
import { PAYMENT_STATUS_RANK } from '../bookings/payment-totals';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingStatus, ProviderType, TaskStatus, UserRole, VendorCategory } from '../../common/enums';

/**
 * The weddings a planner was hired to run.
 *
 * A planner's own Events page lists their own days, of which there are none —
 * they are not the one getting married. What they need is the other people's
 * weddings they are responsible for, and until now the only route to any of it
 * was the plan timeline, one plan at a time, with no way to see who the client
 * actually is.
 *
 * Engagement is read from WeddingPlan.plannerUserId throughout, never invented
 * here. engagePlanner only sets it against a confirmed or completed booking, so
 * it is already the platform's answer to "is this planner working for this
 * couple"; a second definition would eventually disagree with the first.
 */
@Injectable()
export class PlannerClientsService {
  constructor(
    @InjectRepository(WeddingPlan) private readonly plans: Repository<WeddingPlan>,
    @InjectRepository(PlanTask) private readonly tasks: Repository<PlanTask>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorService)
    private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(ServiceOffering)
    private readonly offerings: Repository<ServiceOffering>,
    @InjectRepository(PlannerProfile)
    private readonly plannerProfiles: Repository<PlannerProfile>,
    // Read-only: the price on the table while a booking's total is still 0.00.
    @InjectRepository(Quotation) private readonly quotations: Repository<Quotation>,
    private readonly dashboard: WeddingDashboardService,
  ) {}

  /**
   * Where a wedding has got to.
   *
   * Derived from the date and the tasks, because nothing in the model records
   * a status directly. `cancelled` is deliberately not among the answers: the
   * schema has no way to cancel a wedding plan, and inventing the state here
   * would put a filter on the screen that can never match anything.
   */
  private lifecycle(weddingDate: string | null, tasks: PlanTask[]): 'active' | 'upcoming' | 'completed' {
    if (weddingDate && new Date(weddingDate) < new Date()) return 'completed';
    const started = tasks.some((t) => t.status !== TaskStatus.PENDING);
    return started ? 'active' : 'upcoming';
  }

  /**
   * Naming the two people, from whichever field actually carries it.
   *
   * Gender was the obvious signal and is the wrong one: most profiles do not
   * set it — 338 of them here against 314 that do — and one of the ones that
   * does spells it "Male". The account's role is chosen at registration and is
   * always present, so it leads, and gender is used only to name a second
   * person the account holder manages.
   *
   * The profiles are the account's own first and then the ones it manages. The
   * other half of a match-fixed couple has an account and a profile of their
   * own, which no read keyed on this account ever reached, so a bride's groom
   * read "-" once the match was fixed; `partnerName` is that profile's name. A
   * partner with no account of their own simply has no name to show, which is
   * the truth rather than a blank pretending to be a missing field.
   */
  private couple(
    role: UserRole | null,
    profiles: Profile[],
    partnerName: string | null = null,
  ): { bride: string | null; groom: string | null } {
    const holder = profiles[0]?.displayName ?? null;
    const byGender = (g: string) =>
      profiles.slice(1).find((p) => (p.gender ?? '').toLowerCase() === g)?.displayName ?? null;

    if (role === UserRole.BRIDE) return { bride: holder, groom: byGender('male') ?? partnerName };
    if (role === UserRole.GROOM) return { bride: byGender('female') ?? partnerName, groom: holder };
    // A family member holds the account for somebody else, so neither name is
    // theirs; both come from the profiles they manage.
    return {
      bride: profiles.find((p) => (p.gender ?? '').toLowerCase() === 'female')?.displayName ?? null,
      groom: profiles.find((p) => (p.gender ?? '').toLowerCase() === 'male')?.displayName ?? null,
    };
  }

  /**
   * Each account's profiles in the order couple() reads them: its own, then
   * the ones it manages — a family account's bride and groom are managed
   * profiles, not rows under its own user id.
   */
  private async profilesByAccount(userIds: string[]): Promise<Map<string, Profile[]>> {
    const rows = userIds.length
      ? await this.profiles.find({
          where: [{ userId: In(userIds) }, { managedByUserId: In(userIds) }],
        })
      : [];
    return new Map(
      userIds.map((id) => [
        id,
        [
          ...rows.filter((p) => p.userId === id),
          ...rows.filter((p) => p.managedByUserId === id && p.userId !== id),
        ],
      ]),
    );
  }

  /** The partner's own profile name, when the account has a match-fixed partner. */
  private partnerNameOf(
    partnerUserId: string | undefined,
    profilesBy: Map<string, Profile[]>,
  ): string | null {
    if (!partnerUserId) return null;
    return (
      (profilesBy.get(partnerUserId) ?? []).find((p) => p.userId === partnerUserId)?.displayName ??
      null
    );
  }

  /** The couples' wedding facts, the match-fixed partner's included (EZ1-I160). */
  private weddingFacts(
    userIds: string[],
    partners: Map<string, string>,
  ): Promise<Map<string, WeddingFacts>> {
    return loadWeddingFacts(
      { plans: this.plans, events: this.events, bookings: this.bookings, vendors: this.vendors },
      userIds,
      partners,
    );
  }

  /**
   * The wedding's date, read the same way on every planner screen and on the
   * dashboard: the engaged plan's, else the earliest function's, else the
   * earliest vendor booking's. The plan's date alone left a wedding with dated
   * functions reading "Date not set" and never becoming completed.
   */
  private weddingDateOf(plan: WeddingPlan | null, facts?: WeddingFacts): string | null {
    return plan?.weddingDate ?? (facts ? weddingContextOf(facts).date : null);
  }

  /** Every venue and city the wedding is held at: its functions' and its booked vendors'. */
  private placesOf(facts?: WeddingFacts): { venues: string[]; cities: string[] } {
    const unique = (values: (string | null)[]) =>
      [...new Set(values.filter((v): v is string => Boolean(v)))];
    const events = facts?.events ?? [];
    const booked = facts?.vendorBookings ?? [];
    return {
      venues: unique([...events.map((e) => e.venue), ...booked.map((b) => b.venue)]),
      cities: unique([...events.map((e) => e.city), ...booked.map((b) => b.city)]),
    };
  }

  /** The plans this planner is engaged on, or a refusal. */
  private async engagedPlans(actor: AuthUser): Promise<WeddingPlan[]> {
    if (actor.role !== UserRole.PLANNER && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only a wedding planner has clients here');
    }
    return this.plans.find({
      where: actor.role === UserRole.ADMIN ? {} : { plannerUserId: actor.userId },
      order: { weddingDate: 'ASC' },
    });
  }

  /**
   * One row per client, with enough on it to choose between them.
   *
   * Everything expensive is fetched once for the whole list rather than per
   * row: a planner with thirty weddings would otherwise make a hundred and
   * fifty queries to draw one table.
   */
  async listClients(actor: AuthUser) {
    const plans = await this.engagedPlans(actor);
    if (plans.length === 0) {
      return { clients: [], requests: await this.openRequests(actor), upcomingTasks: [] };
    }

    const hostIds = [...new Set(plans.map((p) => p.userId))];
    // Payment state belongs to the planner engagement booking, not to the
    // client's vendor bookings. Loading it here lets My Weddings say where the
    // planner contract has got to without exposing any vendor financial data.
    const plannerBookingIds = plans
      .map((p) => p.plannerBookingId)
      .filter((id): id is string => Boolean(id));
    const partners = await this.dashboard.fixedPartners(hostIds);
    const accounts = [...new Set([...hostIds, ...partners.values()])];
    const [users, profilesBy, events, tasks, bookings, plannerPayments, facts] = await Promise.all([
      this.users.find({ where: { id: In(hostIds) }, select: ['id', 'email', 'phone', 'role'] }),
      this.profilesByAccount(accounts),
      this.events.find({ where: { userId: In(hostIds) }, order: { eventDate: 'ASC' } }),
      this.tasks.find({ where: { planId: In(plans.map((p) => p.id)) } }),
      // The client's bookings, so the card can carry where each wedding's
      // spending has got to, not only its tasks (EZ1-I7) — the match-fixed
      // partner's included, because either of the couple may have booked.
      this.bookings.find({ where: { userId: In(accounts) } }),
      plannerBookingIds.length
        ? this.payments.find({ where: { bookingId: In(plannerBookingIds) } })
        : Promise.resolve([]),
      this.weddingFacts(hostIds, partners),
    ]);

    const paymentByBooking = new Map<string, string>();
    for (const payment of plannerPayments) {
      const current = paymentByBooking.get(payment.bookingId);
      if (
        !current ||
        (PAYMENT_STATUS_RANK[payment.status] ?? 0) > (PAYMENT_STATUS_RANK[current] ?? 0)
      ) {
        paymentByBooking.set(payment.bookingId, payment.status);
      }
    }

    const userById = new Map(users.map((u) => [u.id, u]));

    const clients = plans.map((plan) => {
      const user = userById.get(plan.userId);
      const all = profilesBy.get(plan.userId) ?? [];
      const own = all.filter((p) => p.userId === plan.userId);
      const partner = partners.get(plan.userId);
      const mine = events.filter((e) => e.userId === plan.userId);
      const planTasks = tasks.filter((t) => t.planId === plan.id);
      const next = mine.find((e) => e.eventDate && new Date(e.eventDate) >= new Date());
      const weddingDate = this.weddingDateOf(plan, facts.get(plan.userId));

      const { bride, groom } = this.couple(
        user?.role ?? null,
        all,
        this.partnerNameOf(partner, profilesBy),
      );

      // A booking is "confirmed" once the vendor has taken the job; anything
      // earlier (requested, quoted, accepted) is still being negotiated.
      // Vendor bookings only: the planner's own engagement is a booking too,
      // and counting it read as a confirmed vendor on a wedding with none.
      // Cancelled ones are neither confirmed nor pending.
      const clientBookings = bookings.filter(
        (b) =>
          b.providerType === ProviderType.VENDOR &&
          b.status !== BookingStatus.CANCELLED &&
          (b.userId === plan.userId || (partner !== undefined && b.userId === partner)),
      );
      const confirmed = clientBookings.filter((b) =>
        [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED].includes(
          b.status,
        ),
      ).length;
      const pendingBookings = clientBookings.length - confirmed;
      // Where the couple said the wedding is when they asked this planner.
      const briefLocation =
        bookings.find((b) => b.id === plan.plannerBookingId)?.plannerBrief?.location ?? null;

      return {
        userId: plan.userId,
        planId: plan.id,
        name: own[0]?.displayName ?? user?.email ?? 'A client',
        bride,
        groom,
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        weddingDate: plan.weddingDate ?? null,
        /** The plan's date, else the earliest function's, else the earliest vendor booking's. */
        derivedWeddingDate: weddingDate,
        location: next?.city ?? mine[0]?.city ?? briefLocation ?? own[0]?.city ?? null,
        events: mine.length,
        nextEvent: next ? { id: next.id, name: next.name, date: next.eventDate } : null,
        tasks: {
          total: planTasks.length,
          done: planTasks.filter((t) => t.status === TaskStatus.DONE).length,
        },
        bookings: {
          total: clientBookings.length,
          confirmed,
          pending: pendingBookings,
        },
        paymentStatus: plan.plannerBookingId
          ? (paymentByBooking.get(plan.plannerBookingId) ?? 'payment_pending')
          : 'payment_pending',
        status: this.lifecycle(weddingDate, planTasks),
      };
    });

    // Deadlines across the whole book, so the dashboard can lead with what is
    // actually due rather than a count (EZ1-I52). Unfinished tasks that carry a
    // due date, soonest first — overdue ones sort to the top — capped so the
    // dashboard shows the next handful rather than the entire backlog.
    const nameByPlan = new Map(clients.map((c) => [c.planId, c.name]));
    const now = new Date();
    const upcomingTasks = tasks
      .filter((t) => t.status !== TaskStatus.DONE && t.dueDate)
      .sort(
        (a, b) =>
          new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime(),
      )
      .slice(0, 12)
      .map((t) => ({
        id: t.id,
        planId: t.planId,
        clientName: nameByPlan.get(t.planId) ?? 'A client',
        title: t.title,
        dueDate: t.dueDate,
        status: t.status,
        overdue: new Date(t.dueDate as string) < now,
      }));

    return { clients, requests: await this.openRequests(actor), upcomingTasks };
  }

  /**
   * Work waiting on an answer.
   *
   * A booking a couple has asked for and the planner has not yet responded to.
   * It belongs on this page because that is where a planner looks for "what is
   * mine", and a request sitting unanswered in a different screen is how a
   * client concludes nobody is there.
   */
  private async openRequests(actor: AuthUser) {
    if (actor.role !== UserRole.PLANNER) return [];
    // The provider id on a planner booking is the planner *profile*, not the
    // user, so this planner's profiles are found first and the query narrowed
    // to them. Taking the fifty newest requests across every planner and
    // filtering afterwards lost this planner's whenever others had newer ones.
    const mine = await this.plannerProfiles.find({
      where: { ownerUserId: actor.userId },
      select: ['id'],
    });
    if (mine.length === 0) return [];
    const requests = await this.bookings.find({
      where: {
        providerType: ProviderType.PLANNER,
        providerId: In(mine.map((p) => p.id)),
        status: BookingStatus.REQUESTED,
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    // Who is asking, by name — a request the planner cannot put a name to reads
    // as noise, and the My Clients page is where they decide whether to take it
    // on (EZ1-I56).
    const userIds = [...new Set(requests.map((b) => b.userId))];
    const [profiles, users] = await Promise.all([
      userIds.length ? this.profiles.find({ where: { userId: In(userIds) } }) : Promise.resolve([]),
      userIds.length ? this.users.find({ where: { id: In(userIds) } }) : Promise.resolve([]),
    ]);
    const nameOf = (uid: string) =>
      profiles.find((p) => p.userId === uid)?.displayName ??
      users.find((u) => u.id === uid)?.email ??
      'A couple';

    return requests.map((b) => ({
      bookingId: b.id,
      userId: b.userId,
      name: nameOf(b.userId),
      amount: b.amount,
      // What the couple hopes to spend: the only figure on a request that has
      // not been quoted, where `amount` is still 0.00.
      expectedBudget: b.expectedBudget ?? null,
      currency: b.currency,
      requestedAt: b.createdAt,
    }));
  }

  /**
   * The wedding behind a booking request, so the planner quotes on the brief
   * rather than on a name and a date (EZ1-I162).
   *
   * Before EZ1-I143 asks a planner whether their quotation arranges the vendors,
   * they need to see what the wedding actually is: every function with its date,
   * timing and venue, the guest count, and — the part that decides the quote —
   * which vendors the couple has already booked against which day, so the
   * planner can tell what is left to source. All of it is assembled read-only
   * from the events and bookings that already exist for the couple; nothing here
   * writes, and it never touches the booking sync paths.
   */
  async requestBrief(actor: AuthUser, bookingId: string) {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('That request could not be found');
    await this.assertMayReviewRequest(actor, booking);

    const clientUserId = booking.userId;
    // A match-fixed couple share one wedding (EZ1-I160): what either of them
    // has arranged is arranged.
    const partners = await this.dashboard.fixedPartners([clientUserId]);
    const partner = partners.get(clientUserId);
    const accounts = partner ? [clientUserId, partner] : [clientUserId];
    const [plan, events, clientBookings, profiles, user, facts] = await Promise.all([
      this.plans.findOne({ where: { userId: clientUserId }, order: { createdAt: 'DESC' } }),
      this.events.find({ where: { userId: In(accounts) }, order: { eventDate: 'ASC' } }),
      this.bookings.find({ where: { userId: In(accounts) }, order: { createdAt: 'DESC' } }),
      this.profiles.find({ where: { userId: clientUserId } }),
      this.users.findOne({ where: { id: clientUserId }, select: ['id', 'email', 'role'] }),
      this.weddingFacts([clientUserId], partners),
    ]);
    const wedding = facts.get(clientUserId);

    // What the couple has already arranged for themselves: the vendor bookings,
    // named and resolved to the service booked, so the planner sees per day what
    // is covered and what they must still source. A cancelled booking is not an
    // arrangement.
    const vendorBookings = clientBookings.filter(
      (b) => b.providerType === ProviderType.VENDOR && b.status !== BookingStatus.CANCELLED,
    );
    const vendorIds = vendorBookings.map((b) => b.providerId);
    const [listings, serviceNameById] = await Promise.all([
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      // The vendor's own wording when they gave one, the catalogue's otherwise
      // (EZ1-I264): `displayName` alone is empty on ordinary catalogue services.
      serviceNamesByIds(this.vendorServices, vendorBookings.map((b) => b.vendorServiceId)),
    ]);
    const vendorById = new Map(listings.map((v) => [v.id, v]));
    const eventById = new Map(events.map((e) => [e.id, e]));

    const arranged = vendorBookings.map((b) => ({
      eventId: b.eventId,
      // The function's date, else the booking's, else the date on its form.
      eventDate: bookingContextOf(b, b.eventId ? eventById.get(b.eventId) : null).eventDate,
      name: vendorById.get(b.providerId)?.name ?? 'Vendor',
      category: vendorById.get(b.providerId)?.category ?? null,
      service: b.vendorServiceId ? (serviceNameById.get(b.vendorServiceId) ?? null) : null,
      status: b.status,
    }));
    const forDisplay = (v: (typeof arranged)[number]) => ({
      name: v.name,
      category: v.category,
      service: v.service,
      status: v.status,
      eventDate: v.eventDate,
    });

    // The requirement at a glance, so the planner sees the whole ask before
    // pricing it (EZ1-I216). The couple's request itself only carries free-text
    // requirements and a budget — there is no structured "which vendor
    // categories, how many vendors" on the request or the events — so it is
    // derived here: the categories the couple has already secured (with counts
    // and the services booked), and the core wedding categories still with
    // nothing against them, which is the gap a planner quotes to fill. Doing it
    // in the service keeps the category enum and the booking-status rules in one
    // place rather than reimplemented on the client; it stays read-only.
    const CORE_CATEGORIES: string[] = [
      VendorCategory.VENUE,
      VendorCategory.CATERING,
      VendorCategory.PHOTOGRAPHY,
      VendorCategory.DECOR,
      VendorCategory.MAKEUP,
      VendorCategory.ENTERTAINMENT,
    ];
    const byCategory = new Map<string, { count: number; services: Set<string> }>();
    for (const v of arranged) {
      const key = v.category ?? 'other';
      const row = byCategory.get(key) ?? { count: 0, services: new Set<string>() };
      row.count += 1;
      if (v.service) row.services.add(v.service);
      byCategory.set(key, row);
    }
    const sourced = [...byCategory.entries()].map(([category, row]) => ({
      category,
      count: row.count,
      services: [...row.services],
    }));
    const toSource = CORE_CATEGORIES.filter((c) => !byCategory.has(c));

    return {
      client: {
        name: profiles[0]?.displayName ?? user?.email ?? 'The couple',
        /*
         * Who the wedding belongs to, so the booking can link to their events
         * rather than only summarising them (EZ1-I195).
         *
         * The brief is read-only and assembled from the Events module, which is
         * right -- event detail has one home and a booking should not carry a
         * second copy to drift from it. But a read-only summary with no way
         * through to the thing it summarises is where a planner starts keeping
         * their own notes, which is how the two diverge in the first place.
         */
        userId: clientUserId,
      },
      /** What the couple asked this planner for, before any quote. */
      request: {
        requirements: booking.requirements ?? null,
        expectedBudget: booking.expectedBudget ?? null,
        currency: booking.currency,
        notes: booking.notes ?? null,
        forEvent: booking.eventId
          ? (events.find((e) => e.id === booking.eventId)?.name ?? null)
          : null,
      },
      wedding: {
        // The plan's date, else the earliest function's or vendor booking's.
        weddingDate: this.weddingDateOf(plan, wedding),
        // The largest function is the wedding's headline guest count; summing the
        // functions would double-count guests invited to more than one day.
        guestCount: events.reduce((n, e) => Math.max(n, e.expectedGuests ?? 0), 0) || null,
        // Where the functions are held and where the booked vendors are, so a
        // venue already booked shows even when no function names it.
        ...this.placesOf(wedding),
        functions: events.length,
      },
      /**
       * What the couple needs, at a glance (EZ1-I216). `sourced` is what they
       * have already arranged, per category; `toSource` is the core wedding
       * categories still open, which is where the planner's quotation comes in.
       * `structuredNeed` is false because the client request does not yet
       * capture required categories or a vendor count as its own fields — this
       * is derived from their events and bookings, and a future client-side
       * capture would make it explicit rather than inferred.
       */
      requirement: {
        vendorsArranged: arranged.length,
        sourced,
        toSource,
        structuredNeed: false,
      },
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.eventDate,
        startTime: e.startTime,
        endTime: e.endTime,
        venue: e.venue ?? null,
        city: e.city,
        expectedGuests: e.expectedGuests,
        budget: e.budget,
        category: e.category,
        theme: e.theme,
        specialRequirements: e.specialRequirements,
        description: e.description,
        arrangedVendors: arranged.filter((v) => v.eventId === e.id).map(forDisplay),
      })),
      // Vendors the couple booked without tying them to a specific function.
      otherVendors: arranged
        .filter((v) => !v.eventId || !events.some((e) => e.id === v.eventId))
        .map(forDisplay),
    };
  }

  /**
   * Who may read a request's brief: the planner it was sent to (the request's
   * providerId is their planner profile, not their user), a planner already
   * engaged on the wedding, or an administrator. Anyone else is refused — the
   * brief is the couple's private planning, not a public listing.
   */
  private async assertMayReviewRequest(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (booking.providerType === ProviderType.PLANNER) {
      const mine = await this.plannerProfiles.find({
        where: { ownerUserId: actor.userId },
        select: ['id'],
      });
      if (mine.some((p) => p.id === booking.providerId)) return;
    }
    const engaged = await this.plans.findOne({
      where: { userId: booking.userId, plannerUserId: actor.userId },
    });
    if (engaged) return;
    throw new ForbiddenException('That request was not sent to you');
  }

  /**
   * Everything about one client, on one screen.
   *
   * The budget, guest counts and planning progress are not recomputed here:
   * WeddingDashboardService already derives them for the couple's own
   * dashboard, and a planner looking at the same wedding must be shown the
   * same numbers. Two implementations of "what has this wedding committed"
   * would disagree, and the planner's copy is the one nobody would notice
   * drifting.
   */
  async clientDetail(actor: AuthUser, clientUserId: string) {
    const plan = await this.plans.findOne({
      where:
        actor.role === UserRole.ADMIN
          ? { userId: clientUserId }
          : { userId: clientUserId, plannerUserId: actor.userId },
      order: { createdAt: 'DESC' },
    });
    if (!plan) throw new NotFoundException('You are not engaged on that wedding');

    // A match-fixed couple share one wedding (EZ1-I160).
    const partners = await this.dashboard.fixedPartners([clientUserId]);
    const partner = partners.get(clientUserId);
    const accounts = partner ? [clientUserId, partner] : [clientUserId];
    const [user, profilesBy, events, tasks, bookings, summary, facts] = await Promise.all([
      this.users.findOne({
        where: { id: clientUserId },
        // `role` is what names the bride or the groom — see couple(). Leaving
        // it out of the select made this page show a dash where the list
        // beside it showed a name, off the same data.
        select: ['id', 'email', 'phone', 'createdAt', 'role'],
      }),
      this.profilesByAccount(accounts),
      this.events.find({ where: { userId: clientUserId }, order: { eventDate: 'ASC' } }),
      this.tasks.find({ where: { planId: plan.id }, order: { dueDate: 'ASC' } }),
      this.bookings.find({ where: { userId: In(accounts) }, order: { createdAt: 'DESC' } }),
      this.dashboard.summary(clientUserId),
      this.weddingFacts([clientUserId], partners),
    ]);

    // Every booking here is this one wedding's, the partner's included.
    const vendorRows = await this.vendorRows(bookings, () => facts.get(clientUserId));
    const all = profilesBy.get(clientUserId) ?? [];
    const own = all.filter((p) => p.userId === clientUserId);
    const { bride, groom } = this.couple(
      user?.role ?? null,
      all,
      this.partnerNameOf(partner, profilesBy),
    );
    const wedding = facts.get(clientUserId);
    const weddingDate = this.weddingDateOf(plan, wedding);

    return {
      client: {
        userId: clientUserId,
        name: own[0]?.displayName ?? user?.email ?? 'A client',
        bride,
        groom,
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        city: own[0]?.city ?? null,
        since: user?.createdAt ?? null,
        status: this.lifecycle(weddingDate, tasks),
      },
      wedding: {
        planId: plan.id,
        weddingDate,
        countdown: summary.countdown,
        functions: events.length,
        ...this.placesOf(wedding),
      },
      /** Spec section 3, and the couple's own journey view — one derivation. */
      progress: summary.journey,
      guests: summary.guests,
      budget: summary.budget,
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.eventDate,
        venue: e.venue,
        city: e.city,
        startTime: e.startTime,
        budget: e.budget,
        status: e.status,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        dueDate: t.dueDate,
        status: t.status,
      })),
      /** Spec section 6: who has been booked, and where each stands. */
      vendors: vendorRows,
    };
  }

  /**
   * Every booking this planner placed on a client's behalf, newest first.
   *
   * A planner's Bookings page lists the work coming in against their own
   * agency, and a request they raised with a vendor for a couple (EZ1-I235) is
   * the couple's booking, not theirs — so it appeared nowhere on it, and the
   * planner could not see which vendor they had just asked. It was only on
   * each client's page, one client at a time.
   *
   * Scoped to rows the caller placed for somebody else, so a planner never
   * reads another planner's requests or a couple's own bookings.
   */
  async placedForClients(actor: AuthUser) {
    const bookings = await this.bookings.find({
      where: { bookedByUserId: actor.userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const forClients = bookings.filter((b) => b.userId !== actor.userId);
    if (forClients.length === 0) return [];

    const clientIds = [...new Set(forClients.map((b) => b.userId))];
    const facts = await this.weddingFacts(clientIds, new Map());
    const [rows, users, profiles] = await Promise.all([
      this.vendorRows(forClients, (userId) => facts.get(userId)),
      this.users.find({ where: { id: In(clientIds) }, select: ['id', 'email'] }),
      this.profiles.find({ where: { userId: In(clientIds) } }),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const nameById = new Map<string, string>();
    for (const p of profiles) {
      if (p.userId && !nameById.has(p.userId)) nameById.set(p.userId, p.displayName);
    }

    return forClients.map((b, i) => ({
      ...rows[i],
      clientUserId: b.userId,
      clientName: nameById.get(b.userId) ?? emailById.get(b.userId) ?? 'A client',
      createdAt: b.createdAt,
    }));
  }

  /**
   * Who each booking is with, what was booked, and where its money has got to
   * (EZ1-I56), in the order the bookings were given.
   */
  private async vendorRows(
    bookings: Booking[],
    // The couple's wedding, so a vendor booking with no place of its own reads
    // the venue or function the couple has on that same day.
    weddingOf: (userId: string) => WeddingFacts | undefined = () => undefined,
  ) {
    const idsOf = (type: ProviderType) => [
      ...new Set(bookings.filter((b) => b.providerType === type).map((b) => b.providerId)),
    ];
    const vendorIds = idsOf(ProviderType.VENDOR);
    const plannerIds = idsOf(ProviderType.PLANNER);
    const offeringIds = [...new Set(bookings.map((b) => b.offeringId).filter(Boolean))] as string[];
    const eventIds = [...new Set(bookings.map((b) => b.eventId).filter(Boolean))] as string[];
    const bookingIds = bookings.map((b) => b.id);
    const [listings, planners, serviceNameById, offeringRows, paymentRows, linkedEvents, quotes] =
      await Promise.all([
        vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
        // A planner booked by the couple is named by their agency, not "Planning".
        plannerIds.length
          ? this.plannerProfiles.find({ where: { id: In(plannerIds) } })
          : Promise.resolve([]),
        // The vendor's own wording when they gave one, the catalogue's otherwise
        // (EZ1-I264).
        serviceNamesByIds(this.vendorServices, bookings.map((b) => b.vendorServiceId)),
        offeringIds.length
          ? this.offerings.find({ where: { id: In(offeringIds) } })
          : Promise.resolve([]),
        bookings.length
          ? this.payments.find({ where: { bookingId: In(bookings.map((b) => b.id)) } })
          : Promise.resolve([]),
        // The function a booking is linked to says when and where it is.
        eventIds.length ? this.events.find({ where: { id: In(eventIds) } }) : Promise.resolve([]),
        bookingIds.length
          ? this.quotations.find({ where: { bookingId: In(bookingIds) } })
          : Promise.resolve([]),
      ]);
    const vendorById = new Map(listings.map((v) => [v.id, v]));
    const plannerById = new Map(planners.map((p) => [p.id, p]));
    const offeringNameById = new Map(offeringRows.map((o) => [o.id, o.name]));
    const eventById = new Map(linkedEvents.map((e) => [e.id, e]));
    // The furthest a booking's money has reached, ranked with the booking
    // service's own rollup so the two screens agree.
    const paymentByBooking = new Map<string, string>();
    for (const p of paymentRows) {
      const seen = paymentByBooking.get(p.bookingId);
      if (!seen || (PAYMENT_STATUS_RANK[p.status] ?? 0) > (PAYMENT_STATUS_RANK[seen] ?? 0)) {
        paymentByBooking.set(p.bookingId, p.status);
      }
    }

    return bookings.map((b) => {
      const isPlanner = b.providerType === ProviderType.PLANNER;
      const listing = isPlanner ? null : vendorById.get(b.providerId);
      // The linked function first, then the day, place and head count the
      // request was placed with, so a function with no venue does not hide the
      // one typed on the form.
      const context = bookingContextOf(
        {
          eventDate: b.eventDate,
          serviceAnswers: b.serviceAnswers,
          providerName: listing?.name,
          providerCity: listing?.city,
          providerIsVenue: Boolean(listing?.categories?.includes('venue')),
        },
        b.eventId ? eventById.get(b.eventId) : null,
        weddingOf(b.userId),
        { wholeWedding: isPlanner },
      );
      return {
        bookingId: b.id,
        name:
          listing?.name ??
          (isPlanner ? (plannerById.get(b.providerId)?.agencyName ?? 'Planning') : 'Provider'),
        category: listing?.category ?? b.providerType,
        service: b.vendorServiceId
          ? (serviceNameById.get(b.vendorServiceId) ?? null)
          : isPlanner
            ? 'Wedding planning'
            : null,
        package: b.offeringId ? (offeringNameById.get(b.offeringId) ?? null) : null,
        status: b.status,
        paymentStatus: paymentByBooking.get(b.id) ?? null,
        amount: b.amount,
        currency: b.currency,
        // The newest quotation and where it stands. `amount` stays the agreed
        // total, which is 0.00 until a quotation is accepted.
        quotation: summariseQuotations(quotes.filter((q) => q.bookingId === b.id)),
        // What the request was placed with: the day, the place, the head
        // count, the budget and the brief, so a planner can see what they
        // asked the vendor for without opening the booking.
        eventDate: context.eventDate,
        venue: context.venue,
        city: context.city,
        guests: context.guests,
        expectedBudget: b.expectedBudget,
        requirements: b.requirements,
      };
    });
  }
}
