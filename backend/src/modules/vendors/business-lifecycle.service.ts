import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { catalogIssues } from '../catalog/catalog-completeness';
import { VerificationService } from '../verification/verification.service';
import {
  BUSINESS_RULES,
  CORRECTABLE_BUSINESS_FIELDS,
  POST_VERIFICATION_EDITABLE_FIELDS,
  canTransition,
  normaliseCorrectionFields,
  rulesFor,
} from './business-lifecycle';
import { ApplicantType, BusinessStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { RedisService } from '../../platform/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../../common/enums';

export interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  /** What is missing, when it is. Shown to the vendor verbatim. */
  missing: string | null;
  /**
   * The individual reasons behind `missing` when there are several: the
   * catalog names each category and service that falls short ("Bridal Wear:
   * pricing is missing for Lehenga"). Absent or empty when complete.
   */
  issues?: string[];
}

/**
 * "Finish these first: ...", naming every reason rather than only the step.
 *
 * The same sentences the checklist shows, so the refusal from the submit route
 * and the screen the vendor is looking at say exactly the same thing.
 */
export function blockingMessage(items: CompletionItem[]): string {
  const parts = items
    .filter((i) => !i.complete)
    .map((i) => (i.issues && i.issues.length > 0 ? `${i.label} (${i.issues.join('; ')})` : i.label));
  return `Finish these first: ${parts.join(', ')}.`;
}

/** JSON with object keys sorted, so equal values print the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Whether a submitted field leaves the stored value as it is.
 *
 * Key order is ignored: Postgres hands a jsonb object back with its keys
 * reordered (`{ url, platform }` for the `{ platform, url }` that was saved),
 * so a plain string comparison called an untouched social link list changed.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * A business from first draft to live, and back when something is wrong.
 *
 * The rules live in `business-lifecycle.ts` as data. This service is the only
 * thing that moves a business between states, which is what makes "can I edit
 * this now?" answerable in one place rather than in ten `if` statements that
 * drift apart.
 */
@Injectable()
export class BusinessLifecycleService {
  constructor(
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorService) private readonly services: Repository<VendorService>,
    @InjectRepository(ServiceOffering) private readonly offerings: Repository<ServiceOffering>,
    // The two reference each other: submitting raises a request, and a
    // decision on that request moves the business back.
    @Inject(forwardRef(() => VerificationService))
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    // Search results are cached; a status change decides who appears in them.
    private readonly redis: RedisService,
    // Read-only: category and service names for the catalog checklist.
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(ServiceDefinition) private readonly definitions: Repository<ServiceDefinition>,
  ) {}

  private async owned(actor: AuthUser, businessId: string): Promise<Vendor> {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');
    if (actor.role !== UserRole.ADMIN && business.ownerUserId !== actor.userId) {
      throw new ForbiddenException('That business is not yours');
    }
    return business;
  }

  /**
   * What is filled in, and what is not.
   *
   * Computed rather than tracked. A "documents complete" flag somebody forgot
   * to clear when a document was removed is worse than no flag at all, because
   * it lets an incomplete listing through the gate.
   */
  async completion(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    const catalogProblems = await this.catalogProblems(business);

    // Business name, category, city, registered address, PAN, a contact mobile
    // and the trading-since date are all mandatory to submit (EZ1-I152). GST
    // and the registration number stay optional — plenty of legitimate small
    // businesses have no GST registration (EZ1-I21).
    const missingIdentity: string[] = [];
    if (!business.name) missingIdentity.push('business name');
    if (!business.categories?.length) missingIdentity.push('category');
    if (!business.city) missingIdentity.push('city');
    if (!business.registeredAddress) missingIdentity.push('registered address');
    if (!business.panNumber) missingIdentity.push('PAN number');
    if (!business.contactPhone) missingIdentity.push('contact mobile number');
    // Trading since is required as well: it is how a couple judges experience,
    // and the form marks it required.
    if (!business.tradingSince) missingIdentity.push('trading since date');

    const items: CompletionItem[] = [
      {
        key: 'business',
        label: 'Business details',
        complete: missingIdentity.length === 0,
        missing: missingIdentity.length ? `Still needed: ${missingIdentity.join(', ')}` : null,
      },
      {
        key: 'catalog',
        label: 'Catalog services',
        // Every selected category needs a service on sale, and every service on
        // sale needs a live price. It used to be "some service has a price", and
        // only the first service's prices were ever read, so a listing with
        // three categories and one priced service went to verification.
        complete: catalogProblems.length === 0,
        missing: catalogProblems.length ? catalogProblems.join('; ') : null,
        issues: catalogProblems,
      },
      {
        key: 'documents',
        label: 'Documents',
        // At least one compliance document is required (EZ1-I152) — an officer
        // has nothing to check against without one. PAN is covered in the
        // business details above.
        complete: (business.complianceDocuments?.length ?? 0) > 0,
        missing:
          (business.complianceDocuments?.length ?? 0) > 0
            ? null
            : 'Upload at least one compliance document',
      },
      {
        key: 'portfolio',
        label: 'Portfolio',
        // At least one portfolio image is required (EZ1-I152).
        complete: (business.portfolio?.length ?? 0) > 0,
        missing:
          (business.portfolio?.length ?? 0) > 0 ? null : 'Add at least one portfolio photo',
      },
    ];

    const blocking = items.filter((i) => !i.complete);
    return {
      businessId,
      status: business.status,
      rules: rulesFor(business.status),
      items,
      canSubmit: blocking.length === 0 && rulesFor(business.status).submit,
      blocking: blocking.map((i) => i.label),
    };
  }

  /**
   * What stops the catalog being complete, one precise sentence each.
   *
   * Read fresh on every call, like the rest of the checklist: switching a price
   * off takes the tick away again.
   */
  private async catalogProblems(business: Vendor): Promise<string[]> {
    const services = await this.services.find({ where: { vendorId: business.id } });
    const [offerings, definitions] = services.length
      ? await Promise.all([
          this.offerings.find({ where: { vendorServiceId: In(services.map((s) => s.id)) } }),
          this.definitions.find({ where: { id: In(services.map((s) => s.definitionId)) } }),
        ])
      : [[] as ServiceOffering[], [] as ServiceDefinition[]];
    const definitionById = new Map(definitions.map((d) => [d.id, d]));

    const selected = business.categories ?? [];
    const categoryIds = [...new Set(definitions.map((d) => d.categoryId))];
    const where = [
      ...(selected.length ? [{ slug: In(selected) }] : []),
      ...(categoryIds.length ? [{ id: In(categoryIds) }] : []),
    ];
    const categories = where.length ? await this.categories.find({ where }) : [];
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

    return catalogIssues(
      selected.map((slug) => ({ slug, name: categoryBySlug.get(slug)?.name ?? null })),
      services.map((service) => {
        const definition = definitionById.get(service.definitionId);
        const category = definition ? categoryById.get(definition.categoryId) : undefined;
        return {
          name: service.displayName || definition?.name || 'Service',
          categorySlug: category?.slug ?? null,
          categoryName: category?.name ?? null,
          active: service.active,
          hasActivePricing: offerings.some((o) => o.vendorServiceId === service.id && o.active),
        };
      }),
    );
  }

  /**
   * The vendor looks the whole thing over before anybody else does.
   *
   * Deliberately still editable at this point: the purpose of a review step is
   * to find things to change, and a review you cannot act on is a confirmation
   * dialog with extra steps.
   */
  async beginFirstReview(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    const state = await this.completion(actor, businessId);

    if (!state.canSubmit && state.blocking.length > 0) {
      throw new BadRequestException(blockingMessage(state.items));
    }
    // The chain goes DRAFT → READY_FOR_REVIEW → FIRST_REVIEW, and this walks it
    // rather than jumping. READY_FOR_REVIEW is not decoration: it is the state
    // that says everything needed is filled in, which is what makes opening the
    // review meaningful in the first place.
    if (business.status === BusinessStatus.DRAFT) {
      await this.move(business, BusinessStatus.READY_FOR_REVIEW, actor);
    }
    if (business.status !== BusinessStatus.FIRST_REVIEW) {
      await this.move(business, BusinessStatus.FIRST_REVIEW, actor);
    }
    return this.completion(actor, businessId);
  }

  /**
   * Submitted for verification. The listing locks here.
   *
   * The lock is enforced by the update APIs rather than by hiding a button:
   * a vendor who edits their GST number after an officer has been sent to check
   * it has verified nothing.
   */
  async submitForVerification(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    const state = await this.completion(actor, businessId);

    if (state.blocking.length > 0) {
      throw new BadRequestException(blockingMessage(state.items));
    }
    // A listing sent back for changes is resubmitted straight from the edit
    // screen. The vendor has been through the whole listing to fix it, so the
    // first-review step is walked here rather than refused: refusing left the
    // listing reading "sent back for changes" after the vendor had pressed
    // submit, with nothing on screen to say a second step was wanted.
    const wasSentBack = business.status === BusinessStatus.REVERIFICATION_REQUIRED;
    if (wasSentBack) {
      await this.move(business, BusinessStatus.FIRST_REVIEW, actor);
    }
    if (!canTransition(business.status, BusinessStatus.PENDING_VERIFICATION)) {
      throw new BadRequestException(
        business.status === BusinessStatus.REJECTED
          ? 'This listing was refused and cannot be resubmitted. Create a new one.'
          : 'Look it over first — open First review, then submit.',
      );
    }

    business.submittedAt = new Date();
    await this.move(business, BusinessStatus.PENDING_VERIFICATION, actor);

    // The verification request is what starts the 72-hour clock. Raised per
    // business, so a vendor's second listing gets its own.
    let request = await this.verification.raise(
      ApplicantType.VENDOR,
      business.ownerUserId,
      business.id,
      business.name,
    );
    // A request still parked from the send-back is a resubmission: it goes back
    // to the administrators for a fresh allocation rather than to the officer
    // who visited last time (and their findings are cleared).
    const resubmitted = this.verification.isAwaitingResubmission(request);
    if (resubmitted) {
      request = await this.verification.markResubmitted(request.id, actor, business.name);
    }
    await this.verification.startSla(request.id);

    // Tracking for the vendor: their own action, confirmed in the feed.
    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_PROGRESS, {
      businessId: business.id,
      requestId: request.id,
      stage: resubmitted || wasSentBack ? 'resubmitted' : 'submitted',
    });

    return { businessId, status: business.status, verificationRequestId: request.id };
  }

  /**
   * An officer or administrator sends it back.
   *
   * Edit access comes back with it, which is the entire difference between this
   * and a rejection.
   */
  async requireReverification(businessId: string, reason: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    business.decisionReason = reason;
    business.revisionCount += 1;
    // A free reopen, not a targeted correction: the vendor may edit anything the
    // state allows, so any earlier field restriction is lifted here.
    business.correctionFields = null;
    business.correctionSnapshot = null;
    await this.move(business, BusinessStatus.REVERIFICATION_REQUIRED, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.REVERIFICATION_REQUIRED,
      reason,
      round: business.revisionCount,
    });
    return business;
  }

  /**
   * Sends the listing back for a fix to *named* fields only (EZ1-I205).
   *
   * The difference from `requireReverification` is the whole feature: the vendor
   * gets edit access to exactly the flagged fields and nothing else, and the
   * values those fields held now are kept so the officer can see previous
   * against updated when it comes back. Enforced on the update path — see
   * `assertCorrectionScope` — because a correction the vendor can edit around is
   * not a correction.
   */
  async requireCorrection(
    businessId: string,
    reason: string,
    fields: string[],
    actor?: AuthUser,
  ) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    const allowed = (normaliseCorrectionFields(fields) as string[]).filter((f) =>
      (CORRECTABLE_BUSINESS_FIELDS as readonly string[]).includes(f),
    );
    if (allowed.length === 0) {
      throw new BadRequestException('Name at least one business field to correct.');
    }

    // Snapshot what is there now, before the vendor touches it, so the re-review
    // has a before to compare the after against.
    const snapshot: Record<string, unknown> = {};
    for (const field of allowed) {
      snapshot[field] = (business as unknown as Record<string, unknown>)[field] ?? null;
    }

    business.decisionReason = reason;
    business.revisionCount += 1;
    business.correctionFields = allowed;
    business.correctionSnapshot = snapshot;
    await this.move(business, BusinessStatus.REVERIFICATION_REQUIRED, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.REVERIFICATION_REQUIRED,
      reason,
      fields: allowed,
      correction: true,
      round: business.revisionCount,
    });
    return business;
  }

  /**
   * Refuses an edit to a field the vendor was not asked to correct.
   *
   * Only bites while a targeted correction is outstanding (`correctionFields`
   * set). A field the payload leaves at its current value passes whether or not
   * it was flagged, so the client may send the whole record back; only an actual
   * change to an unflagged field is refused.
   */
  assertCorrectionScope(business: Vendor, dto: Record<string, unknown>): void {
    const allowed = business.correctionFields;
    if (!allowed || allowed.length === 0) return;

    const allow = new Set(allowed);
    // The correction key for categories is still 'category'; it opens the list
    // that replaced it (EZ1-I263).
    if (allow.has('category')) allow.add('categories');
    // The profile picture is one of the portfolio images, and each document's
    // type belongs to the document: they open with those fields.
    if (allow.has('portfolio')) allow.add('profileImage');
    if (allow.has('complianceDocuments')) allow.add('complianceDocumentTypes');
    const current = business as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined || allow.has(key)) continue;
      if (!sameValue(value, current[key] ?? null)) {
        throw new ForbiddenException(
          `Only the fields flagged for correction can be changed right now: ${allowed.join(', ')}.`,
        );
      }
    }
  }

  /** Refused. Terminal: the listing is archived and a new one is the way on. */
  async reject(businessId: string, reason: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    business.decisionReason = reason;
    business.archivedAt = new Date();
    business.isApproved = false;
    business.correctionFields = null;
    business.correctionSnapshot = null;
    await this.move(business, BusinessStatus.REJECTED, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.REJECTED,
      reason,
    });
    return business;
  }

  /**
   * Whether a decision could land, asked before anything is written.
   *
   * `decide` used to save the request and then activate the applicant. When the
   * activation was refused — approving a listing that had been sent back and
   * not yet resubmitted, say — the request was already marked approved and the
   * business was not, which is the worst of both: the queue says done and the
   * vendor is still waiting.
   */
  async canDecide(
    businessId: string,
    outcome: 'approve' | 'reject' | 'revisit' | 'correct',
  ): Promise<{ ok: boolean; reason: string | null }> {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return { ok: true, reason: null };

    // Another review is another officer's visit to the same, still-locked
    // listing; a correction hands the listing back to the vendor to edit.
    const target =
      outcome === 'approve'
        ? BusinessStatus.VERIFIED
        : outcome === 'reject'
          ? BusinessStatus.REJECTED
          : outcome === 'revisit'
            ? BusinessStatus.PENDING_VERIFICATION
            : BusinessStatus.REVERIFICATION_REQUIRED;

    if (business.status === target) return { ok: true, reason: null };
    if (canTransition(business.status, target)) return { ok: true, reason: null };

    return {
      ok: false,
      reason:
        business.status === BusinessStatus.REVERIFICATION_REQUIRED
          ? 'That listing was sent back and has not been resubmitted yet.'
          : `A ${business.status} listing cannot be ${outcome}d.`,
    };
  }

  /** Approved. Verified, then live — and the identity locks for good. */
  async approve(businessId: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    business.verifiedAt = new Date();
    business.decisionReason = null;
    // The correction, if there was one, has been checked and passed. Clear it so
    // a later free edit is not silently held to a stale field restriction.
    business.correctionFields = null;
    business.correctionSnapshot = null;
    await this.move(business, BusinessStatus.VERIFIED, actor);
    await this.move(business, BusinessStatus.LIVE, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.LIVE,
    });
    return business;
  }

  /**
   * An administrator asked for another review (ADDITIONAL_REVIEW).
   *
   * That is a second, independent visit to the listing exactly as submitted,
   * so it stays locked and returns to "awaiting verification". It used to be
   * sent back to the vendor with edit access and the administrator's note as
   * the reason, which both exposed an internal remark and made the revisit
   * impossible to approve until the vendor happened to resubmit.
   */
  async awaitAnotherReview(businessId: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;
    if (business.status === BusinessStatus.VERIFICATION_IN_PROGRESS) {
      await this.move(business, BusinessStatus.PENDING_VERIFICATION, actor);
    }
    return business;
  }

  /**
   * Reopens a refused listing for correction, on an administrator's approval of
   * a support case about it (row 27).
   *
   * Refusal is terminal for every other path, which is why this is not in the
   * transition table: only an administrator approving an officer's
   * "unlock business details" resolution on a support case reaches it. The
   * listing returns to REVERIFICATION_REQUIRED with full edit access, is
   * un-archived, and the vendor is told with the case note as the reason.
   */
  async reopenRejected(businessId: string, reason: string, actor: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business || business.status !== BusinessStatus.REJECTED) return null;

    const from = business.status;
    business.status = BusinessStatus.REVERIFICATION_REQUIRED;
    business.isApproved = BUSINESS_RULES[BusinessStatus.REVERIFICATION_REQUIRED].visible;
    business.archivedAt = null;
    business.decisionReason = reason;
    business.revisionCount += 1;
    business.correctionFields = null;
    business.correctionSnapshot = null;
    await this.vendors.save(business);
    await this.audit.record({
      action: AuditAction.VENDOR_APPROVED,
      actor,
      resourceType: 'vendor',
      resourceId: business.id,
      metadata: { from, to: business.status, reason, via: 'support_case_unlock' },
    });

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.REVERIFICATION_REQUIRED,
      reason,
      round: business.revisionCount,
    });
    return business;
  }

  /** An officer has started; the business follows the request. */
  async markInProgress(businessId: string) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;
    if (!canTransition(business.status, BusinessStatus.VERIFICATION_IN_PROGRESS)) return business;
    await this.move(business, BusinessStatus.VERIFICATION_IN_PROGRESS);
    return business;
  }

  /**
   * The single writer for a business's status.
   *
   * `isApproved` is maintained here rather than anywhere else, so search and
   * the lifecycle cannot disagree about whether a business is live.
   */
  private async move(business: Vendor, to: BusinessStatus, actor?: AuthUser): Promise<Vendor> {
    const from = business.status;
    if (from !== to && !canTransition(from, to)) {
      throw new BadRequestException(`A ${from} listing cannot move to ${to}`);
    }

    business.status = to;
    business.isApproved = BUSINESS_RULES[to].visible;
    const saved = await this.vendors.save(business);

    // Every status move can change who search shows — going live, being
    // suspended or unlisted — and search is cached for a minute, so a vendor
    // just approved was missing from it until the cache ran out. Cleared here,
    // at the one writer of a business's status. A cache that cannot be reached
    // must not undo a decision already saved; it expires on its own.
    if (from !== to) {
      try {
        const keys = await this.redis.raw.keys('vendors:search:*');
        if (keys.length) await this.redis.del(...keys);
      } catch {
        // The cached pages lapse within their 60-second lifetime regardless.
      }
    }

    await this.audit.record({
      action: AuditAction.VENDOR_APPROVED,
      actor,
      resourceType: 'vendor',
      resourceId: business.id,
      metadata: { from, to, reason: business.decisionReason },
    });
    return saved;
  }

  /** What this business may do right now. Rendered by the client as-is. */
  async rulesFor(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    return { businessId, status: business.status, ...rulesFor(business.status) };
  }

  /**
   * The one guard for a vendor identity update (EZ1-I207).
   *
   * Three cases, decided from the state rules alone so the update path cannot
   * get them out of step:
   *  - full identity edit (draft, review, reverification) — allowed, and
   *    narrowed to the flagged fields when a targeted correction is out;
   *  - verified or live — the legally-checked fields are locked, but the
   *    presentational ones (about, contact, portfolio) stay editable;
   *  - anything else (pending, in progress, rejected) — nothing is editable.
   *
   * A field the payload leaves at its current value always passes, so the client
   * may send the whole record back; only an actual change to a locked field is
   * refused.
   */
  assertIdentityEditable(business: Vendor, dto: Record<string, unknown>): void {
    const rules = rulesFor(business.status);
    if (rules.editIdentity) {
      this.assertCorrectionScope(business, dto);
      return;
    }
    if (rules.editPresentational) {
      this.assertPresentationalScope(business, dto);
      return;
    }
    throw new ForbiddenException(rules.note);
  }

  /**
   * Refuses a change to anything but the presentational fields once a listing is
   * verified or live (EZ1-I207).
   *
   * Same shape as `assertCorrectionScope`: an unchanged field passes whether or
   * not it is presentational, so the existing form can post the whole record;
   * only an actual edit to a locked, legally-checked field is refused.
   */
  private assertPresentationalScope(business: Vendor, dto: Record<string, unknown>): void {
    const allow = new Set<string>(POST_VERIFICATION_EDITABLE_FIELDS);
    const current = business as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined || allow.has(key)) continue;
      if (!sameValue(value, current[key] ?? null)) {
        throw new ForbiddenException(
          'This listing is verified. Only the description, contact number, portfolio and social ' +
            'links can be changed here — for the verified details, raise a change request.',
        );
      }
    }
  }
}
