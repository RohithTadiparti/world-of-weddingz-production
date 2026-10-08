import { randomUUID } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlannerProfile, PlannerWedding } from './entities/planner-profile.entity';
import { PlannerFavourite } from './entities/planner-favourite.entity';
import {
  PlannerSearchDto,
  PlannerWeddingDto,
  UpsertPlannerProfileDto,
} from './dto/wedding-planner.dto';
import { RedisService } from '../../platform/redis/redis.service';
import { assertMediaValueUploaded, assertNewMediaUploaded } from '../../platform/storage/kept-media';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { VerificationService } from '../verification/verification.service';
import { ApplicantType } from '../../common/enums';
import { likeEscape } from '../../common/util/like';
import { resolveSocialLinks } from '../../common/dto/social-links.dto';

/**
 * The columns of a planner listing that are private to the planner and the
 * platform: who owns it, where escrow pays out to, and how to reach them
 * directly. A couple reaches a planner through a booking request, not a phone
 * number, exactly as with a vendor (see PublicVendor).
 */
const PRIVATE_PLANNER_FIELDS = [
  'ownerUserId',
  'payoutAccountId',
  'contactPerson',
  'contactPhone',
  'contactEmail',
  'address',
  'pincode',
] as const;

export type PublicPlanner = Omit<PlannerProfile, (typeof PRIVATE_PLANNER_FIELDS)[number]>;

/** A planner listing as the public sees it: the business, never the row. */
export function publicPlanner(profile: PlannerProfile): PublicPlanner {
  const view: Record<string, unknown> = { ...profile };
  for (const field of PRIVATE_PLANNER_FIELDS) delete view[field];
  return view as PublicPlanner;
}

@Injectable()
export class WeddingPlannersService {
  constructor(
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(PlannerFavourite) private readonly favourites: Repository<PlannerFavourite>,
    private readonly redis: RedisService,
    private readonly verification: VerificationService,
  ) {}

  /**
   * One listing per planner account: upsert on ownerUserId rather than insert,
   * so a planner cannot spam the directory with duplicate profiles.
   */
  async upsertOwn(ownerUserId: string, dto: UpsertPlannerProfileDto): Promise<PlannerProfile> {
    let profile = await this.planners.findOne({ where: { ownerUserId } });
    if (!profile) {
      profile = this.planners.create({ ownerUserId, isApproved: false });
    } else if (!profile.isApproved) {
      // A rejected planner cannot edit-and-resubmit its way back into review
      // (EZ1-I66, EZ1-I72). Checked before mutating so a refused resubmit leaves
      // the saved listing untouched.
      await this.verification.assertNotRejected(ownerUserId, profile.id);
    }
    assertPlannerMedia(dto, profile);
    // The list and the single columns mirroring it move together, whichever
    // of them the client sent (see resolveSocialLinks).
    const { socialLinks: _list, weddings, ...fields } = dto;
    Object.assign(profile, fields, resolveSocialLinks(dto, profile) ?? {});
    if (weddings) profile.weddings = keepWeddingIds(weddings, profile.weddings ?? []);
    const saved = await this.planners.save(profile);

    /*
     * Saving the listing is what puts a planner in front of an administrator.
     *
     * Nothing did this before, so the screen said "pending administrator
     * review" and no administrator was ever shown anything to review — the
     * planner sat at that step permanently with no way forward and nobody to
     * ask. `raise` is idempotent per subject, so editing the listing again does
     * not queue a second visit.
     *
     * Only while unapproved: an approved planner editing their prices is not
     * asking to be verified again.
     */
    if (!saved.isApproved) {
      await this.verification.raise(ApplicantType.PLANNER, ownerUserId, saved.id, saved.agencyName);
    }

    await this.invalidateSearchCache();
    return saved;
  }

  async getOwn(ownerUserId: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { ownerUserId } });
    if (!profile) throw new NotFoundException('You have not created a planner listing yet');
    return profile;
  }

  /** Resolves the listing a booking points at, and its owner. */
  async findByIdOrFail(id: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Planner not found');
    return profile;
  }

  async search(q: PlannerSearchDto): Promise<PaginatedResult<PublicPlanner>> {
    const cacheKey = `planners:search:${q.city ?? 'all'}:${q.minRating ?? 0}:${q.page}:${q.limit}`;
    return this.redis.wrap(cacheKey, 60, async () => {
      const qb = this.planners
        .createQueryBuilder('p')
        .where('p."isApproved" = :approved', { approved: true });
      if (q.city) {
        // Same partial match as the vendor search, for the same reason: this
        // was an equality, so a half-typed city found nobody. The serves-cities
        // array stays an exact containment check — that is a list the planner
        // chose from, not something a client types.
        qb.andWhere('(p.city ILIKE :cityLike OR p."servesCities" @> :cityJson)', {
          cityLike: `%${likeEscape(q.city)}%`,
          cityJson: JSON.stringify([q.city]),
        });
      }
      if (q.minRating !== undefined) {
        qb.andWhere('p."ratingAvg" >= :minRating', { minRating: q.minRating });
      }
      qb.orderBy('p."ratingAvg"', 'DESC')
        .skip((q.page - 1) * q.limit)
        .take(q.limit);
      const [data, total] = await qb.getManyAndCount();
      return paginate(data.map(publicPlanner), total, q.page, q.limit);
    });
  }

  async findOne(id: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { id, isApproved: true } });
    if (!profile) throw new NotFoundException('Planner not found');
    return profile;
  }

  /**
   * One approved listing as the public sees it. An unapproved listing is a 404
   * here (its owner reads it through `/me`), and the private columns are never
   * returned — see PublicPlanner.
   */
  async findPublic(id: string): Promise<PublicPlanner> {
    return publicPlanner(await this.findOne(id));
  }

  /** Whether the caller has saved this planner. */
  async isFavourite(userId: string, plannerId: string): Promise<{ favourite: boolean }> {
    const row = await this.favourites.findOne({ where: { userId, plannerId } });
    return { favourite: Boolean(row) };
  }

  /**
   * Save or unsave a planner. Idempotent both ways: a second save, or removing
   * one that was never saved, gives the same answer as the first.
   */
  async setFavourite(
    userId: string,
    plannerId: string,
    favourite: boolean,
  ): Promise<{ favourite: boolean }> {
    if (!favourite) {
      await this.favourites.delete({ userId, plannerId });
      return { favourite: false };
    }
    await this.findOne(plannerId);
    await this.favourites
      .createQueryBuilder()
      .insert()
      .into(PlannerFavourite)
      .values({ userId, plannerId })
      .orIgnore()
      .execute();
    return { favourite: true };
  }

  /** The caller's saved planners that are still listed, most recently saved first. */
  async listFavourites(userId: string): Promise<PublicPlanner[]> {
    const rows = await this.favourites.find({ where: { userId }, order: { createdAt: 'DESC' } });
    if (!rows.length) return [];
    const listed = await this.planners.find({
      where: { id: In(rows.map((r) => r.plannerId)), isApproved: true },
    });
    const byId = new Map(listed.map((p) => [p.id, p]));
    return rows
      .map((r) => byId.get(r.plannerId))
      .filter((p): p is PlannerProfile => Boolean(p))
      .map(publicPlanner);
  }

  async approve(id: string): Promise<PlannerProfile> {
    const profile = await this.findByIdOrFail(id);
    profile.isApproved = true;
    const saved = await this.planners.save(profile);
    await this.invalidateSearchCache();
    return saved;
  }

  listPending(): Promise<PlannerProfile[]> {
    return this.planners.find({ where: { isApproved: false }, order: { createdAt: 'ASC' } });
  }

  private async invalidateSearchCache(): Promise<void> {
    const keys = await this.redis.raw.keys('planners:search:*');
    if (keys.length) await this.redis.del(...keys);
  }
}

/**
 * The listing form sends the portfolio and every wedding back whole, photos
 * and all. A picture the listing already holds may come back as it is, even
 * one stored before uploads were enforced; anything new must be an upload.
 *
 * A wedding's pictures are matched against every wedding's stored pictures
 * rather than the one with the same id, so moving a photo between weddings,
 * or a client that drops the ids, is not mistaken for adding a new one.
 */
function assertPlannerMedia(dto: UpsertPlannerProfileDto, profile: PlannerProfile): void {
  assertNewMediaUploaded('portfolio', dto.portfolio, profile.portfolio);
  if (!dto.weddings) return;
  const stored = (profile.weddings ?? []).flatMap((w) => [w.coverUrl, ...(w.photos ?? [])]);
  dto.weddings.forEach((w, i) => {
    assertMediaValueUploaded('coverUrl', w.coverUrl, stored, `weddings.${i}.`);
    assertNewMediaUploaded('photos', w.photos, stored, `weddings.${i}.`);
  });
}

/**
 * The weddings as sent, with ids that last.
 *
 * A wedding's id is part of its page address, so an edit must not mint a new
 * one: an id the listing already holds is kept, and anything else (a new
 * wedding, or an id the client made up) gets a fresh one from here.
 */
function keepWeddingIds(sent: PlannerWeddingDto[], saved: PlannerWedding[]): PlannerWedding[] {
  const known = new Set(saved.map((w) => w.id));
  const used = new Set<string>();
  return sent.map((w) => {
    const id = w.id && known.has(w.id) && !used.has(w.id) ? w.id : randomUUID();
    used.add(id);
    return {
      id,
      title: w.title.trim(),
      location: w.location ?? null,
      date: w.date ?? null,
      description: w.description ?? null,
      coverUrl: w.coverUrl ?? null,
      photos: w.photos ?? [],
      videos: w.videos ?? [],
      events: (w.events ?? []).map((e) => ({
        name: e.name.trim(),
        date: e.date ?? null,
        description: e.description ?? null,
      })),
    };
  });
}
