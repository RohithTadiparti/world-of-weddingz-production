import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorReview } from '../vendors/entities/vendor-review.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Profile } from '../users/entities/profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { OfficerServiceArea } from '../verification/entities/officer-service-area.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import {
  OfficerAvailability,
  availabilityView,
} from '../verification/entities/officer-availability.entity';
import { DirectoryQueryDto } from './dto/console.dto';
import { CaseStatus, UserRole, VerificationStatus } from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { serviceNamesByIds } from '../catalog/service-names';
import { AdminBookingsService } from './admin-bookings.service';
import { maskEmail, maskPhone } from '../../common/util/pii-mask';
import { contactMatches, contactSearchClause } from '../../common/util/contact-search';
import { likeEscape } from '../../common/util/like';

/**
 * Businesses and staff on the admin console.
 *
 * The activity feed, the account directory, bookings and payments, and the
 * reports each moved to their own service when this file passed 1,600 lines.
 */
@Injectable()
export class AdminConsoleService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorReview) private readonly reviews: Repository<VendorReview>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(VendorService) private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(ServiceOffering) private readonly offerings: Repository<ServiceOffering>,
    @InjectRepository(ServiceDefinition) private readonly definitions: Repository<ServiceDefinition>,
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(OfficerServiceArea)
    private readonly serviceAreas: Repository<OfficerServiceArea>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    // Read-only, for whether an officer is reachable right now and when they
    // were last seen — the roster question a bare account row cannot answer.
    @InjectRepository(RefreshSession) private readonly sessions: Repository<RefreshSession>,
    // Read-only, for an officer's leave state (EZ1-I210) on the roster.
    @InjectRepository(OfficerAvailability)
    private readonly availability: Repository<OfficerAvailability>,
    private readonly adminBookings: AdminBookingsService,
  ) {}

  /**
   * One vendor business in full (EZ1-I188).
   *
   * The vendor account drill-down lists a vendor's businesses by name and
   * status; this is what opens when an administrator clicks one — the
   * registration and compliance details, every service in the catalogue with
  * its offerings, the uploaded documents, the verification
   * history, and the bookings taken against it.
   */
  async businessDetail(vendorId: string) {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');

    const [owner, services, verifications, receivedRaw, reviews] = await Promise.all([
      this.users.findOne({
        where: { id: vendor.ownerUserId },
        select: ['id', 'email', 'role', 'isActive', 'phone', 'createdAt'],
      }),
      this.vendorServices.find({ where: { vendorId }, order: { createdAt: 'ASC' } }),
      this.verifications.find({ where: { subjectId: vendorId }, order: { createdAt: 'DESC' } }),
      this.bookings.find({
        where: { providerId: vendorId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.reviews.find({ where: { vendorId }, order: { createdAt: 'DESC' }, take: 50 }),
    ]);

    const allServiceIds = services.map((s) => s.id);
    const definitions = allServiceIds.length
      ? await this.definitions.find({ where: { id: In(services.map((s) => s.definitionId)) } })
      : [];
    const categoryIds = [...new Set(definitions.map((definition) => definition.categoryId))];
    const categories = categoryIds.length
      ? await this.categories.find({ where: { id: In(categoryIds) } })
      : [];
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    // Every service is shown, including one whose category the business no
    // longer lists: an administrator has to see everything the business could
    // still be holding bookings against. Those are flagged instead.
    const selectedCategories = vendor.categories ?? [];
    const categoryOf = (service: VendorService) =>
      categoryById.get(definitionById.get(service.definitionId)?.categoryId ?? '') ?? null;
    const outsideSelected = (service: VendorService) => {
      if (selectedCategories.length === 0) return false;
      const category = categoryOf(service);
      return !category || !selectedCategories.includes(category.slug);
    };
    const serviceIds = allServiceIds;
    const offerings = serviceIds.length
      ? await this.offerings.find({
          where: { vendorServiceId: In(serviceIds) },
          order: { sortOrder: 'ASC' },
        })
      : [];
    const offeringsByService = new Map<string, ServiceOffering[]>();
    for (const o of offerings) {
      const list = offeringsByService.get(o.vendorServiceId) ?? [];
      list.push(o);
      offeringsByService.set(o.vendorServiceId, list);
    }

    const [bookings, serviceNames] = await Promise.all([
      this.adminBookings.attachParties(receivedRaw),
      // `displayName` is only the vendor's override; the catalogue names the rest.
      serviceNamesByIds(this.vendorServices, serviceIds),
    ]);

    return {
      business: {
        id: vendor.id,
        name: vendor.name,
        category: vendor.category,
        categories: vendor.categories ?? [],
        otherCategory: vendor.otherCategory,
        description: vendor.description,
        city: vendor.city,
        pricing: vendor.pricing ?? {},
        portfolio: vendor.portfolio ?? [],
        ratingAvg: vendor.ratingAvg,
        ratingCount: vendor.ratingCount,
        // Registration & compliance.
        gstNumber: vendor.gstNumber,
        panNumber: vendor.panNumber,
        registrationNumber: vendor.registrationNumber,
        tradingSince: vendor.tradingSince,
        registeredAddress: vendor.registeredAddress,
        contactPhone: vendor.contactPhone,
        complianceDocuments: vendor.complianceDocuments ?? [],
        // Lifecycle.
        status: vendor.status,
        isApproved: vendor.isApproved,
        submittedAt: vendor.submittedAt,
        verifiedAt: vendor.verifiedAt,
        decisionReason: vendor.decisionReason,
        revisionCount: vendor.revisionCount,
        archivedAt: vendor.archivedAt,
        payoutAccountId: vendor.payoutAccountId,
        createdAt: vendor.createdAt,
        updatedAt: vendor.updatedAt,
      },
      owner,
      /** Services & catalogue, each with its priced offerings and category. */
      services: services.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        name: serviceNames.get(s.id) ?? null,
        category: categoryOf(s),
        outsideSelectedCategories: outsideSelected(s),
        description: s.description,
        active: s.active,
        offerings: (offeringsByService.get(s.id) ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          pricingModel: o.pricingModel,
          price: o.price,
          currency: o.currency,
          unitLabel: o.unitLabel,
          isPackage: o.isPackage,
          inclusions: o.inclusions,
          active: o.active,
        })),
      })),
      verifications: verifications.map((v) => ({
        id: v.id,
        status: v.status,
        applicantType: v.applicantType,
        remarks: v.remarks,
        findings: v.findings,
        decidedAt: v.decidedAt,
        submittedAt: v.submittedAt,
        createdAt: v.createdAt,
      })),
      bookings,
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        moderationReason: review.moderationReason,
        createdAt: review.createdAt,
      })),
    };
  }

  /**
   * Every business on the platform, by state.
   *
   * A vendor's *account* and their *businesses* are different rows, and this
   * lists the businesses — which is what a question like "how many listings are
   * stuck in first review" is actually about.
   *
   * The search box takes the business name or the owner's email or mobile,
   * matched on the raw columns; the owner's email and the listing's phone come
   * back masked (ISS-11).
   */
  async businesses(q: DirectoryQueryDto): Promise<
    PaginatedResult<
      Vendor & { owner: { email: string | null; isActive: boolean; createdAt: Date } | null }
    >
  > {
    const qb = this.vendors.createQueryBuilder('v');
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    const needle = q.q?.trim();
    if (q.active !== undefined || needle) {
      qb.leftJoin(User, 'owner', 'owner.id = v.ownerUserId');
    }
    if (needle) {
      const contact = contactSearchClause({ email: 'owner.email', phone: 'owner.phone' }, needle);
      qb.andWhere(`(LOWER(v.name) LIKE :needle OR ${contact.clause})`, {
        needle: `%${likeEscape(needle.toLowerCase())}%`,
        ...contact.params,
      });
    }
    if (q.city) qb.andWhere('LOWER(v.city) = LOWER(:city)', { city: q.city });
    // Filtered here, against every owner, rather than by the client against
    // whichever page of accounts it happened to load.
    if (q.active !== undefined) {
      qb.andWhere('owner.isActive = :active', { active: q.active === true });
    }

    qb.orderBy('v.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();

    // Each row names its owner's account, so a page of businesses is complete
    // on its own.
    const ownerIds = [...new Set(data.map((v) => v.ownerUserId))];
    const owners = ownerIds.length
      ? await this.users.find({
          where: { id: In(ownerIds) },
          select: ['id', 'email', 'isActive', 'createdAt'],
        })
      : [];
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    const rows = data.map((v) => {
      const owner = ownerById.get(v.ownerUserId);
      return Object.assign(v, {
        contactPhone: maskPhone(v.contactPhone),
        owner: owner
          ? { email: maskEmail(owner.email), isActive: owner.isActive, createdAt: owner.createdAt }
          : null,
      });
    });
    return paginate(rows, total, q.page, q.limit);
  }

  /**
   * The two staff directories, kept apart.
   *
   * An administrator and a field officer are not variants of one thing. One
   * decides who gets access; the other goes to an address and writes down what
   * they saw. Listing them together is how somebody gets given the wrong one —
   * and the officer rows carry a workload the admin rows have no meaning for.
   */
  async staff(kind: 'admin' | 'in_person') {
    const role = kind === 'admin' ? UserRole.ADMIN : UserRole.IN_PERSON;
    const rows = await this.users.find({
      where: { role },
      select: ['id', 'email', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    // Masked like every administrator list (ISS-11).
    if (kind === 'admin') {
      return rows.map((u) => ({ ...u, email: maskEmail(u.email), role, openCases: 0, openVisits: 0 }));
    }

    const ids = rows.map((u) => u.id);
    const [openCases, openVisits] = await Promise.all([
      ids.length
        ? this.cases.find({
            where: {
              assignedToUserId: In(ids),
              status: In([
                CaseStatus.ALLOCATED,
                CaseStatus.IN_PROGRESS,
                CaseStatus.WAITING_FOR_INFORMATION,
                CaseStatus.ESCALATED,
                CaseStatus.REASSIGNED,
              ]),
            },
          })
        : ([] as SupportCase[]),
      ids.length
        ? this.verifications.find({
            where: {
              assignedToUserId: In(ids),
              status: In([VerificationStatus.ASSIGNED, VerificationStatus.IN_PROGRESS]),
            },
          })
        : ([] as VerificationRequest[]),
    ]);

    return rows.map((u) => ({
      ...u,
      email: maskEmail(u.email),
      role,
      // Deliberately two numbers rather than one total: a queue of six visits
      // and a queue of six disputes are different amounts of work, and an
      // allocator choosing on the sum picks the wrong officer.
      openCases: openCases.filter((c) => c.assignedToUserId === u.id).length,
      openVisits: openVisits.filter((v) => v.assignedToUserId === u.id).length,
    }));
  }

  /**
   * The verification officers as a roster an administrator can actually run
   * (EZ1-I212).
   *
   * `staff()` above answers "who is carrying what" in one line each; this
   * answers the question before it — "is this a person I can send a visit to
   * right now": their coverage, whether the account is live, whether they are
   * online, and the shape of their queue split into verifications and cases.
   * Built from the aggregates allocation already trusts — the same verification
   * status counts and `officer_service_areas` rows the allocator ranks on — so
   * a number here can never disagree with a number the allocator saw.
   *
   * Availability (Available / On Leave / Unavailable) is a separate change
   * (EZ1-I210) that introduces the field. Until it lands every officer reads as
   * `available`, so the column and its filter exist now and start telling the
   * truth the day the field arrives — no second pass on this screen.
   *
   * Emails come back masked (ISS-11), so the roster's search is answered here:
   * `search` matches the raw email or mobile, the name, the id or a coverage
   * label, and only matching officers are returned.
   */
  async officers(search?: string) {
    const all = await this.users.find({
      where: { role: UserRole.IN_PERSON },
      select: ['id', 'email', 'phone', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    if (all.length === 0) return [];
    const rows = search?.trim() ? await this.officersMatching(all, search) : all;
    const ids = rows.map((u) => u.id);
    if (ids.length === 0) return [];

    const now = Date.now();
    // A live session touched inside this window is somebody at their desk; an
    // older one is a login they never signed out of. Presence, not history.
    const ONLINE_WINDOW_MS = 5 * 60 * 1000;

    const [profiles, areas, verifRows, caseRows, sessions, availabilityRows] = await Promise.all([
      this.profiles.find({
        where: { userId: In(ids) },
        select: ['userId', 'displayName', 'city'],
      }),
      this.serviceAreas.find({
        where: { officerUserId: In(ids) },
        order: { primary: 'DESC', createdAt: 'ASC' },
      }),
      this.verifications
        .createQueryBuilder('r')
        .select('r."assignedToUserId"', 'officerUserId')
        .addSelect('r.status', 'status')
        .addSelect('COUNT(r.id)', 'count')
        .where('r."assignedToUserId" IN (:...ids)', { ids })
        .groupBy('r."assignedToUserId"')
        .addGroupBy('r.status')
        .getRawMany<{ officerUserId: string; status: string; count: string }>(),
      this.cases
        .createQueryBuilder('c')
        .select('c."assignedToUserId"', 'officerUserId')
        .addSelect('c.status', 'status')
        .addSelect('COUNT(c.id)', 'count')
        .where('c."assignedToUserId" IN (:...ids)', { ids })
        .groupBy('c."assignedToUserId"')
        .addGroupBy('c.status')
        .getRawMany<{ officerUserId: string; status: string; count: string }>(),
      this.sessions.find({
        where: { userId: In(ids), revokedAt: IsNull() },
        select: ['userId', 'lastUsedAt', 'expiresAt', 'createdAt'],
      }),
      this.availability.find({ where: { officerUserId: In(ids) } }),
    ]);

    const profileFor = new Map(profiles.map((p) => [p.userId as string, p]));
    const availabilityFor = new Map(availabilityRows.map((a) => [a.officerUserId, a]));

    // A visit that is written up and on an administrator's desk is off the
    // officer's plate — counted as completed, not pending, exactly as the
    // allocator's workload() treats it.
    const V_PENDING: string[] = [
      VerificationStatus.ASSIGNED,
      VerificationStatus.ADDITIONAL_REVIEW,
      VerificationStatus.ISSUE,
    ];
    const V_PROGRESS: string[] = [VerificationStatus.IN_PROGRESS];
    const V_DONE: string[] = [
      VerificationStatus.SUBMITTED,
      VerificationStatus.ADMIN_REVIEW,
      VerificationStatus.APPROVED,
      VerificationStatus.REJECTED,
    ];

    const C_PENDING: string[] = [
      CaseStatus.OPEN,
      CaseStatus.TRIAGED,
      CaseStatus.ALLOCATED,
      CaseStatus.REASSIGNED,
      CaseStatus.ESCALATED,
      CaseStatus.WAITING_FOR_INFORMATION,
    ];
    const C_PROGRESS: string[] = [CaseStatus.IN_PROGRESS];
    const C_DONE: string[] = [
      CaseStatus.RESOLUTION_SUBMITTED,
      CaseStatus.ADMIN_REVIEW,
      CaseStatus.RESOLVED,
      CaseStatus.REJECTED,
      CaseStatus.CLOSED,
    ];

    const tally = (
      list: { officerUserId: string; status: string; count: string }[],
      id: string,
      statuses: string[],
    ) =>
      list
        .filter((r) => r.officerUserId === id && statuses.includes(r.status))
        .reduce((n, r) => n + Number(r.count), 0);

    return rows.map((u) => {
      const mine = sessions.filter((s) => s.userId === u.id);
      const lastActiveAt = mine.reduce<Date | null>((latest, s) => {
        const at = s.lastUsedAt ?? s.createdAt;
        return !latest || at > latest ? at : latest;
      }, null);
      const online = mine.some(
        (s) =>
          s.lastUsedAt &&
          new Date(s.expiresAt).getTime() > now &&
          now - new Date(s.lastUsedAt).getTime() < ONLINE_WINDOW_MS,
      );

      const verifications = {
        pending: tally(verifRows, u.id, V_PENDING),
        inProgress: tally(verifRows, u.id, V_PROGRESS),
        completed: tally(verifRows, u.id, V_DONE),
      };
      const supportCases = {
        pending: tally(caseRows, u.id, C_PENDING),
        inProgress: tally(caseRows, u.id, C_PROGRESS),
        completed: tally(caseRows, u.id, C_DONE),
      };

      const availability = availabilityView(availabilityFor.get(u.id));

      return {
        id: u.id,
        email: maskEmail(u.email),
        // Officers rarely have a profile; the (masked) email still says who they are.
        name: profileFor.get(u.id)?.displayName ?? maskEmail(u.email),
        city: profileFor.get(u.id)?.city ?? null,
        isActive: u.isActive,
        // Real leave state from EZ1-I210. An officer with no row has never set
        // anything; allocation still treats them as available, but the roster
        // says "not set" rather than reading "Available" as a choice they made.
        availability: availability.neverSet ? 'not_set' : availability.status,
        online,
        lastActiveAt,
        serviceAreas: areas
          .filter((a) => a.officerUserId === u.id)
          .map((a) => ({ label: a.label, primary: a.primary })),
        verifications,
        cases: supportCases,
        /** Visits closed out on the ground — the completed half of the queue. */
        visitsCompleted: verifications.completed,
        joinedAt: u.createdAt,
      };
    });
  }

  /**
   * The officers a roster search names: raw email or mobile, display name, id
   * or coverage label. The roster is a few dozen people, so it is matched in
   * memory with two small reads rather than a join per field.
   */
  private async officersMatching<T extends { id: string; email: string | null; phone: string | null }>(
    officers: T[],
    search: string,
  ): Promise<T[]> {
    const needle = search.trim().toLowerCase();
    const ids = officers.map((o) => o.id);
    const [profiles, areas] = await Promise.all([
      this.profiles.find({ where: { userId: In(ids) }, select: ['userId', 'displayName'] }),
      this.serviceAreas.find({ where: { officerUserId: In(ids) }, select: ['officerUserId', 'label'] }),
    ]);
    const words = new Map<string, string[]>();
    const add = (id: string | null, value: string | null | undefined) => {
      if (!id || !value) return;
      words.set(id, [...(words.get(id) ?? []), value.toLowerCase()]);
    };
    for (const p of profiles) add(p.userId, p.displayName);
    for (const a of areas) add(a.officerUserId, a.label);
    return officers.filter(
      (o) =>
        contactMatches(o, needle) ||
        o.id.toLowerCase().includes(needle) ||
        (words.get(o.id) ?? []).some((value) => value.includes(needle)),
    );
  }
}
