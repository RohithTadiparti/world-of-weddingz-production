import { Injectable, NotFoundException } from '@nestjs/common';
import { Interest } from '../matchmaking/entities/interest.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { OfficerServiceArea } from '../verification/entities/officer-service-area.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { DirectoryQueryDto } from './dto/console.dto';
import {
  InterestStatus,
  MatchFixedState,
  PaymentStatus,
  UserRole,
  VerificationStatus,
} from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AdminBookingsService } from './admin-bookings.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { maskEmail, maskPhone } from '../../common/util/pii-mask';
import { contactSearchClause } from '../../common/util/contact-search';
import { likeEscape } from '../../common/util/like';
import { AdminNameRepositories, adminAccountNames } from '../users/display-names';

/** What the audited reveal returns for one account. */
export interface RevealedAccountContact {
  id: string;
  email: string | null;
  phone: string | null;
  /** The contact line on each vendor business the account owns. */
  businesses: { id: string; contactPhone: string | null }[];
  /** The contact lines on each planner business the account owns. */
  plannerBusinesses: { id: string; contactPhone: string | null; contactEmail: string | null }[];
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/**
 * The admin directory, and one account or profile in full.
 *
 * Split out of AdminConsoleService, which had grown past 1,600 lines; the
 * methods moved unchanged.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(ProfileDetails) private readonly profileDetails: Repository<ProfileDetails>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(OfficerServiceArea)
    private readonly serviceAreas: Repository<OfficerServiceArea>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    // Read-only, for the matchmaking half of an individual's history.
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    // Read-only, for the agency name an agent account is listed under.
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    private readonly adminBookings: AdminBookingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * An account's email and mobile number, unmasked, for the administrator who
   * has to actually contact the person.
   *
   * The detail page shows both masked; this is the one read that returns them
   * whole, it sits behind its own permission, and every call leaves an audit
   * row naming who looked and whose details they saw.
   */
  async revealContact(actor: AuthUser, userId: string): Promise<RevealedAccountContact> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'email', 'phone'],
    });
    if (!user) throw new NotFoundException('Account not found');

    /*
     * The businesses the account runs carry their own contact lines, masked on
     * the account and business detail pages like the account's (WOW-05). They
     * are this account's contact details too, so the one audited reveal
     * returns them rather than each page inventing a reveal of its own.
     */
    const [vendors, planners] = await Promise.all([
      this.vendors.find({ where: { ownerUserId: user.id }, select: ['id', 'contactPhone'] }),
      this.planners.find({
        where: { ownerUserId: user.id },
        select: ['id', 'contactPhone', 'contactEmail'],
      }),
    ]);

    await this.audit.record({
      action: AuditAction.ADMIN_CONTACT_REVEALED,
      actor,
      resourceType: 'user',
      resourceId: user.id,
      metadata: {
        fields: ['email', 'phone'],
        businesses: vendors.map((v) => v.id),
        plannerBusinesses: planners.map((p) => p.id),
      },
    });
    return {
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      businesses: vendors.map((v) => ({ id: v.id, contactPhone: v.contactPhone ?? null })),
      plannerBusinesses: planners.map((p) => ({
        id: p.id,
        contactPhone: p.contactPhone ?? null,
        contactEmail: p.contactEmail ?? null,
      })),
    };
  }

  /**
   * A marriage profile's own contact lines, unmasked (WOW-05).
   *
   * They are not the owner account's: an agent-created profile has a contact
   * number and no account at all. "View full profile" shows them masked; this
   * is the audited read behind its reveal button.
   */
  async revealProfileContact(
    actor: AuthUser,
    profileId: string,
  ): Promise<{ id: string; email: string | null; phone: string | null }> {
    const profile = await this.profiles.findOne({
      where: { id: profileId },
      select: ['id', 'contactEmail', 'contactPhone'],
    });
    if (!profile) throw new NotFoundException('Profile not found');

    await this.audit.record({
      action: AuditAction.ADMIN_CONTACT_REVEALED,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { fields: ['contactEmail', 'contactPhone'] },
    });
    return {
      id: profile.id,
      email: profile.contactEmail ?? null,
      phone: profile.contactPhone ?? null,
    };
  }

  /** The sources an administrator list names accounts from. */
  private nameRepos(): AdminNameRepositories {
    return {
      users: this.users,
      profiles: this.profiles,
      details: this.profileDetails,
      vendors: this.vendors,
      planners: this.planners,
      agencies: this.agencies,
    };
  }

  /**
   * The accounts directory, filtered the way an administrator actually looks.
   *
   * `listUsers` already pages by role. What it could not do is answer "show me
   * the suspended ones" or "find this email", which is how somebody arrives
   * here — from a complaint naming a person, not from a wish to browse.
   *
   * The search runs on the raw email and mobile columns, so a full or partial
   * address or number still finds the account; the rows that come back carry
   * both masked (ISS-11). The whole value is one click away on the account
   * detail, behind the audited reveal.
   */
  async directory(q: DirectoryQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const qb = this.users
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.email',
        'u.phone',
        'u.role',
        'u.isActive',
        'u.isVerified',
        'u.managedByAgentId',
        'u.createdAt',
      ]);

    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.active !== undefined) {
      qb.andWhere('u.isActive = :active', { active: q.active === true });
    }
    if (q.agentId) qb.andWhere('u.managedByAgentId = :agentId', { agentId: q.agentId });
    if (q.q?.trim()) {
      // The rows lead with a name now (WOW-01..04), so a name finds them too:
      // the profile's display name or the business the account runs.
      const search = contactSearchClause({ email: 'u.email', phone: 'u.phone' }, q.q);
      const named = [
        'EXISTS (SELECT 1 FROM profiles np WHERE np."userId" = u.id AND LOWER(np."displayName") LIKE :nameNeedle)',
        'EXISTS (SELECT 1 FROM vendors nv WHERE nv."ownerUserId" = u.id AND LOWER(nv.name) LIKE :nameNeedle)',
        'EXISTS (SELECT 1 FROM planner_profiles npl WHERE npl."ownerUserId" = u.id AND LOWER(npl."agencyName") LIKE :nameNeedle)',
        'EXISTS (SELECT 1 FROM agent_profiles na WHERE na."ownerUserId" = u.id AND LOWER(na."agencyName") LIKE :nameNeedle)',
      ];
      qb.andWhere(`(${search.clause} OR ${named.join(' OR ')})`, {
        ...search.params,
        nameNeedle: `%${likeEscape(q.q.trim().toLowerCase())}%`,
      });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    const names = await adminAccountNames(this.nameRepos(), data);
    const rows = data.map((user) => ({
      ...user,
      // The person first (WOW-01..04); the business is its own column for the
      // provider roles. Both are names, never contact values.
      name: names.get(user.id)?.name ?? null,
      personName: names.get(user.id)?.personName ?? null,
      businessName: names.get(user.id)?.businessName ?? null,
      email: maskEmail(user.email),
      phone: maskPhone(user.phone),
      contactMasked: true,
    }));
    return paginate(rows as unknown as Record<string, unknown>[], total, q.page, q.limit);
  }

  /**
   * One account and everything hanging off it.
   *
   * The screen this feeds exists because the alternative — an administrator
   * opening six lists and filtering each by a uuid — is how the wrong account
   * gets suspended. Password and MFA columns are never selected: there is
   * nothing an administrator can do with a hash except leak it.
   */
  async accountDetail(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'role',
        'isActive',
        'isVerified',
        'managedByAgentId',
        'phone',
        'createdAt',
      ],
    });
    if (!user) throw new NotFoundException('Account not found');

    const [profiles, listings, placed, raised, against, verifications] = await Promise.all([
      this.profiles.find({ where: [{ userId }, { managedByUserId: userId }] }),
      this.vendors.find({ where: { ownerUserId: userId } }),
      // Booked for this account, or placed by it for somebody else — a planner
      // or agent requesting for a couple.
      this.bookings.find({
        where: [{ userId }, { bookedByUserId: userId }],
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.cases.find({
        where: { raisedByUserId: userId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.cases.find({
        where: { assignedToUserId: userId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.verifications.find({ where: { applicantUserId: userId } }),
    ]);

    const distinctProfiles = uniqueById(profiles);
    const profileIds = distinctProfiles.map((p) => p.id);

    /*
     * The provider side (EZ1-I172).
     *
     * `placed` above is what this account booked as a buyer. A vendor or
     * planner account also has bookings made *with* them — keyed by their
     * business/profile id, not their user id — which is the list their detail
     * page is actually about. Fetched here so the same read serves both.
     */
    const plannerBusinesses = await this.planners.find({ where: { ownerUserId: userId } });
    const providerIds = [...new Set([...listings.map((v) => v.id), ...plannerBusinesses.map((p) => p.id)])];
    const providerBookings = providerIds.length
      ? uniqueById(await this.adminBookings.attachParties(
          await this.bookings.find({
            where: { providerId: In(providerIds) },
            order: { createdAt: 'DESC' },
            take: 20,
          }),
        ))
      : [];

    // Aggregates use the complete relationships; the arrays above remain
    // bounded recent activity for a fast detail page.
    const providerMetrics = providerIds.length
      ? await Promise.all([
          this.bookings.count({ where: { providerId: In(providerIds) } }),
          ...[PaymentStatus.HELD_IN_ESCROW, PaymentStatus.RELEASED].map(async (status) =>
            this.payments
              .createQueryBuilder('p')
              .innerJoin('bookings', 'b', 'b.id = p.bookingId')
              .where('b.providerId IN (:...providerIds)', { providerIds })
              .andWhere('p.status = :status', { status })
              .select('COALESCE(SUM(p.amount), 0)', 'total')
              .getRawOne<{ total: string }>(),
          ),
        ]).then(([bookings, escrow, released]) => ({
          bookings,
          inEscrow: escrow?.total ?? '0',
          released: released?.total ?? '0',
        }))
      : { bookings: 0, inEscrow: '0', released: '0' };

    const agentMetrics = user.role === UserRole.AGENT
      ? await Promise.all([
          this.users.count({ where: { managedByAgentId: userId } }),
          this.bookings.count({ where: { bookedByUserId: userId } }),
        ]).then(([clients, bookings]) => ({ clients, bookings }))
      : null;

    const officerMetrics = user.role === UserRole.IN_PERSON
      ? await Promise.all(
          Object.values(VerificationStatus).map(async (status) => [
            status,
            await this.verifications.count({ where: { assignedToUserId: userId, status } }),
          ] as const),
        ).then((rows) => Object.fromEntries(rows))
      : null;

    /*
     * The parts that only make sense for some accounts.
     *
     * Asked conditionally rather than always, because the honest answer for an
     * officer's matchmaking history is not an empty array — it is that the
     * question does not apply, and a screen showing four empty sections
     * teaches an administrator to stop reading it.
     */
    const [interests, money, agencyClients, officerLoad, officerAreas, officerDecisions] =
      await Promise.all([
        profileIds.length
          ? this.interests.find({
              where: [{ fromProfileId: In(profileIds) }, { toProfileId: In(profileIds) }],
              order: { createdAt: 'DESC' },
              take: 50,
            })
          : Promise.resolve([]),
        this.payments.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 }),
        user.role === UserRole.AGENT
          ? this.users.find({
              where: { managedByAgentId: userId },
              select: ['id', 'email', 'role', 'isActive', 'createdAt'],
            })
          : Promise.resolve([]),
        user.role === UserRole.IN_PERSON
          ? this.verifications.find({
              where: { assignedToUserId: userId },
              order: { createdAt: 'DESC' },
            })
          : Promise.resolve([]),
        // Where this officer travels (EZ1-I188), and the visits they have
        // actually decided — assigned work is the queue, decisions are the record.
        user.role === UserRole.IN_PERSON
          ? this.serviceAreas.find({
              where: { officerUserId: userId },
              order: { createdAt: 'ASC' },
            })
          : Promise.resolve([]),
        user.role === UserRole.IN_PERSON
          ? this.verifications.find({
              where: { decidedByUserId: userId },
              order: { decidedAt: 'DESC' },
              take: 20,
            })
          : Promise.resolve([]),
      ]);

    /*
     * The agency dashboard is deliberately built from profiles, rather than
     * just user accounts. An agent can have a perfectly valid client profile
     * before that person claims an account, and excluding it made the admin
     * view disagree with the agent's own dashboard.
     */
    const agentDashboard =
      user.role === UserRole.AGENT
        ? await this.agentDashboard(userId)
        : null;

    // The matchmaking story as counts, because fifty interest rows is not an
    // answer to "where is this person up to".
    const distinctInterests = uniqueById(interests);
    const distinctMoney = uniqueById(money);
    const distinctRaised = uniqueById(raised);
    const distinctAssigned = uniqueById(against);
    const distinctVerifications = uniqueById(verifications);
    const distinctOfficerLoad = uniqueById(officerLoad);
    const distinctOfficerDecisions = uniqueById(officerDecisions);
    const paymentSum = (status?: PaymentStatus) => {
      const query = this.payments
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.userId = :userId', { userId });
      if (status) query.andWhere('p.status = :status', { status });
      return query.getRawOne<{ total: string }>().then((row) => row?.total ?? '0');
    };
    const [paymentTotal, paymentEscrow, paymentReleased, paymentRefunded] = await Promise.all([
      paymentSum(),
      paymentSum(PaymentStatus.HELD_IN_ESCROW),
      paymentSum(PaymentStatus.RELEASED),
      paymentSum(PaymentStatus.REFUNDED),
    ]);

    // Named the way the lists name them (WOW-01..04), so the page heading and
    // the row an administrator clicked agree — and an agent is not headed with
    // the first client profile they happen to steward.
    const names = await adminAccountNames(this.nameRepos(), [user, ...agencyClients]);

    const matchmaking = profileIds.length
      ? {
          sent: distinctInterests.filter((i) => profileIds.includes(i.fromProfileId)).length,
          received: distinctInterests.filter((i) => profileIds.includes(i.toProfileId)).length,
          accepted: distinctInterests.filter((i) => i.status === InterestStatus.ACCEPTED).length,
          fixed: distinctInterests.filter((i) => i.matchFixedState === MatchFixedState.CONFIRMED).length,
          history: distinctInterests.slice(0, 20),
        }
      : null;

    return {
      /*
       * Contact details masked by default (ISS-11). An administrator needs to
       * recognise the account far more often than to dial it; the full values
       * are a separate, audited read (`revealContact`).
       */
      user: {
        ...user,
        name: names.get(user.id)?.name ?? null,
        personName: names.get(user.id)?.personName ?? null,
        businessName: names.get(user.id)?.businessName ?? null,
        email: maskEmail(user.email),
        phone: maskPhone(user.phone),
        contactMasked: true,
      },
      profiles: distinctProfiles.map((p) => ({
        id: p.id,
        // Whose profile: the account's own, or one it stewards for a client.
        userId: p.userId,
        own: p.userId === userId,
        displayName: p.displayName,
        lifecycle: p.lifecycle,
        city: p.city,
      })),
      businesses: listings.map((v) => ({
        id: v.id,
        name: v.name,
        category: v.category,
        categories: v.categories ?? [],
        status: v.status,
        isApproved: v.isApproved,
      })),
      // Named the same way as `providerBookings`: buyer, provider, service,
      // what has been paid and the quotation on the table.
      bookings: uniqueById(await this.adminBookings.attachParties(placed)),
      /** Bookings made *with* this account (vendor/planner), newest first. */
      providerBookings,
      metrics: {
        provider: providerMetrics,
        agent: agentMetrics,
        officer: officerMetrics,
      },
      /**
       * A planner's own agency record(s) — the vendor equivalent is `businesses`.
       * The full agency detail (packages, coverage, contact) rides along so the
       * planner detail page can show everything without a second read (EZ1-I188).
       */
      plannerBusinesses: plannerBusinesses.map((p) => ({
        id: p.id,
        name: p.agencyName,
        city: p.city,
        isApproved: p.isApproved,
        bio: p.bio,
        servesCities: p.servesCities,
        packages: p.packages,
        yearsExperience: p.yearsExperience,
        contactPerson: p.contactPerson,
        // Masked like the account's own (WOW-05); the account reveal returns
        // them whole alongside the account's email and mobile.
        contactPhone: maskPhone(p.contactPhone),
        contactEmail: maskEmail(p.contactEmail),
        contactMasked: true,
        address: p.address,
        state: p.state,
        pincode: p.pincode,
        website: p.website,
        socialLinks: p.socialLinks ?? [],
        ratingAvg: p.ratingAvg,
        ratingCount: p.ratingCount,
      })),
      casesRaised: distinctRaised,
      casesAssigned: distinctAssigned,
      verifications: distinctVerifications,

      matchmaking,

      /** What this account has paid, and what state it is in. */
      payments: {
        total: paymentTotal,
        inEscrow: paymentEscrow,
        released: paymentReleased,
        refunded: paymentRefunded,
        history: distinctMoney.slice(0, 20),
      },

      /** Only for an agency: the accounts they brought on. */
      agency:
        user.role === UserRole.AGENT
          ? {
              clients: agencyClients.map((client) => ({
                ...client,
                name: names.get(client.id)?.name ?? null,
                email: maskEmail(client.email),
              })),
              charges: await this.charges.find({
                where: { agentUserId: userId },
                order: { createdAt: 'DESC' },
                take: 20,
              }),
            }
          : null,

      /** Live, agent-scoped figures and the records behind each figure. */
      agentDashboard,

      /**
       * Only for an officer: the workload, which is the thing an administrator
       * reallocating work needs and cannot get from anywhere else.
       */
      officer:
        user.role === UserRole.IN_PERSON
          ? {
              assigned: distinctOfficerLoad.length,
              open: distinctOfficerLoad.filter((v) => !['approved', 'rejected'].includes(String(v.status)))
                .length,
              overdue: distinctOfficerLoad.filter(
                (v) => v.slaBreachedAt || (v.slaDeadline && new Date(v.slaDeadline) < new Date()),
              ).length,
              queue: distinctOfficerLoad.slice(0, 20),
              /** The regions this officer will actually travel to (EZ1-I188). */
              serviceAreas: officerAreas.map((a) => ({
                id: a.id,
                label: a.label,
                city: a.city,
                state: a.state,
                primary: a.primary,
              })),
              /** Visits this officer has closed out — the record behind the queue. */
              decisions: distinctOfficerDecisions.map((v) => ({
                id: v.id,
                applicantType: v.applicantType,
                status: v.status,
                decidedAt: v.decidedAt,
                createdAt: v.createdAt,
              })),
            }
          : null,
    };
  }

  private async agentDashboard(agentId: string) {
    const clients = uniqueById(await this.profiles.find({
      where: { managedByUserId: agentId, archivedAt: IsNull() },
      order: { createdAt: 'DESC' },
    }));
    const clientProfileIds = clients.map((client) => client.id);
    const clientUserIds = clients
      .map((client) => client.userId)
      .filter((id): id is string => Boolean(id));

    if (!clientProfileIds.length) {
      return {
        totalClients: 0, matchesFixed: 0, remainingClients: 0,
        interestsReceived: 0, interestsSent: 0, escrow: '0.00',
        issuesPending: 0, issuesSolved: 0, issuesEscalated: 0,
        clients: [], matches: [], interestsReceivedRows: [], interestsSentRows: [],
        payments: [], pendingIssues: [], solvedIssues: [], escalatedIssues: [],
      };
    }

    const [agentInterests, payments, assignedCases, clientCases] = await Promise.all([
      this.interests.find({
        where: [{ fromProfileId: In(clientProfileIds) }, { toProfileId: In(clientProfileIds) }],
        order: { createdAt: 'DESC' },
      }),
      clientUserIds.length
        ? this.payments.find({ where: { userId: In(clientUserIds) }, order: { createdAt: 'DESC' } })
        : Promise.resolve([]),
      this.cases.find({ where: { assignedToUserId: agentId }, order: { createdAt: 'DESC' } }),
      clientUserIds.length
        ? this.cases.find({ where: { raisedByUserId: In(clientUserIds) }, order: { createdAt: 'DESC' } })
        : Promise.resolve([]),
    ]);

    const distinctInterests = uniqueById(agentInterests);
    const distinctPayments = uniqueById(payments);
    const distinctAssignedCases = uniqueById(assignedCases);
    const distinctClientCases = uniqueById(clientCases);
    const fixedClientIds = new Set<string>();
    for (const interest of distinctInterests) {
      if (interest.matchFixedState !== MatchFixedState.CONFIRMED) continue;
      if (clientProfileIds.includes(interest.fromProfileId)) fixedClientIds.add(interest.fromProfileId);
      if (clientProfileIds.includes(interest.toProfileId)) fixedClientIds.add(interest.toProfileId);
    }
    const issues = [...new Map([...distinctAssignedCases, ...distinctClientCases].map((issue) => [issue.id, issue])).values()];
    const openStatuses = new Set([
      'open', 'triaged', 'allocated', 'in_progress', 'waiting_for_information', 'resolution_submitted', 'reassigned',
    ]);
    const pendingIssues = issues.filter((issue) => openStatuses.has(String(issue.status)));
    const solvedIssues = issues.filter((issue) => String(issue.status) === 'resolved');
    const escalatedIssues = issues.filter((issue) => String(issue.status) === 'escalated');
    const escrow = distinctPayments
      .filter((payment) => [PaymentStatus.HELD_IN_ESCROW, PaymentStatus.DISPUTED].includes(payment.status))
      .reduce((total, payment) => total + Number(payment.amount ?? 0), 0)
      .toFixed(2);

    return {
      totalClients: clients.length,
      matchesFixed: fixedClientIds.size,
      remainingClients: clients.length - fixedClientIds.size,
      interestsReceived: distinctInterests.filter((interest) => clientProfileIds.includes(interest.toProfileId)).length,
      interestsSent: distinctInterests.filter((interest) => clientProfileIds.includes(interest.fromProfileId)).length,
      escrow,
      issuesPending: pendingIssues.length,
      issuesSolved: solvedIssues.length,
      issuesEscalated: escalatedIssues.length,
      clients: clients.map((client) => ({
        id: client.id, userId: client.userId, displayName: client.displayName,
        profileCode: client.profileCode, city: client.city, profileCompleted: client.profileCompleted,
        lifecycle: client.lifecycle, createdAt: client.createdAt,
      })),
      matches: distinctInterests.filter((interest) => interest.matchFixedState === MatchFixedState.CONFIRMED),
      interestsReceivedRows: distinctInterests.filter((interest) => clientProfileIds.includes(interest.toProfileId)),
      interestsSentRows: distinctInterests.filter((interest) => clientProfileIds.includes(interest.fromProfileId)),
      payments: distinctPayments,
      pendingIssues,
      solvedIssues,
      escalatedIssues,
    };
  }

  /**
   * One marriage profile in full (EZ1-I185).
   *
   * The account drill-down lists an agency's associated profiles by name; this
   * is what opens when an administrator clicks one — the whole profile, not the
   * matchmaking-facing subset. The government id *number* is never stored and
   * never returned; only the last four and whether an officer verified it.
   */
  async profileDetail(profileId: string) {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const [owner, steward, interests, verifier, details] = await Promise.all([
      profile.userId
        ? this.users.findOne({
            where: { id: profile.userId },
            select: ['id', 'email', 'role', 'isActive', 'isVerified', 'phone', 'createdAt'],
          })
        : Promise.resolve(null),
      profile.managedByUserId
        ? this.users.findOne({
            where: { id: profile.managedByUserId },
            select: ['id', 'email', 'role'],
          })
        : Promise.resolve(null),
      this.interests.find({
        where: [{ fromProfileId: profileId }, { toProfileId: profileId }],
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      profile.idVerifiedByUserId
        ? this.users.findOne({
            where: { id: profile.idVerifiedByUserId },
            select: ['id', 'email'],
          })
        : Promise.resolve(null),
      // The matrimonial biodata behind the profile, for the personal facts the
      // profile row itself does not carry — marital status, height, education
      // and occupation (EZ1-I194).
      this.profileDetails.findOne({ where: { profileId } }),
    ]);
    const names = await adminAccountNames(
      this.nameRepos(),
      [owner, steward, verifier].filter((u): u is User => Boolean(u)),
    );

    return {
      profile: {
        id: profile.id,
        profileCode: profile.profileCode,
        displayName: profile.displayName,
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth,
        city: profile.city,
        address: profile.address,
        bio: profile.bio,
        photos: profile.photos ?? [],
        preferences: profile.preferences ?? {},
        // Contact and stewardship. Masked like every administrator surface
        // (WOW-05): this is the "View full profile" page, which used to print
        // the number whole while the list beside it hid it. The full values
        // are the audited `revealProfileContact`.
        contactEmail: maskEmail(profile.contactEmail),
        contactPhone: maskPhone(profile.contactPhone),
        contactMasked: true,
        stewardRelation: profile.stewardRelation,
        managingFor: profile.managingFor,
        claimStatus: profile.claimStatus,
        // Circulation and lifecycle.
        networkVisibility: profile.networkVisibility,
        visibility: profile.visibility,
        lifecycle: profile.lifecycle,
        lifecycleReason: profile.lifecycleReason,
        profileCompleted: profile.profileCompleted,
        lastActiveAt: profile.lastActiveAt,
        pooledAt: profile.pooledAt,
        // Identity verification, number excluded by design.
        governmentIdType: profile.governmentIdType,
        governmentIdLast4: profile.governmentIdLast4,
        idSubmittedAt: profile.idSubmittedAt,
        idVerifiedAt: profile.idVerifiedAt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      // The accounts around the profile, masked the same way; each has its own
      // account page with the account reveal.
      owner: owner
        ? {
            ...owner,
            name: names.get(owner.id)?.name ?? null,
            email: maskEmail(owner.email),
            phone: maskPhone(owner.phone),
            contactMasked: true,
          }
        : null,
      steward: steward
        ? { ...steward, name: names.get(steward.id)?.name ?? null, email: maskEmail(steward.email) }
        : null,
      verifiedBy: verifier
        ? { ...verifier, name: names.get(verifier.id)?.name ?? null, email: maskEmail(verifier.email) }
        : null,
      // Personal facts kept on the biodata table, not the profile row (EZ1-I194).
      details: details
        ? {
            maritalStatus: details.maritalStatus,
            heightCm: details.heightCm,
            highestQualification: details.highestQualification,
            occupationStatus: details.occupationStatus,
          }
        : null,
      matchmaking: {
        sent: interests.filter((i) => i.fromProfileId === profileId).length,
        received: interests.filter((i) => i.toProfileId === profileId).length,
        accepted: interests.filter((i) => i.status === InterestStatus.ACCEPTED).length,
        fixed: interests.filter((i) => i.matchFixedState === MatchFixedState.CONFIRMED).length,
      },
    };
  }
}
