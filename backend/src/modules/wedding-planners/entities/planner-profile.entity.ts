import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialLink } from '../../../common/dto/social-links.dto';

export interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

export interface PlannerWeddingEvent {
  name: string;
  date?: string | null;
  description?: string | null;
}

/** One wedding in a planner's portfolio. `id` is assigned on save and kept across edits. */
export interface PlannerWedding {
  id: string;
  title: string;
  location?: string | null;
  date?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  photos: string[];
  videos: string[];
  events: PlannerWeddingEvent[];
}

/**
 * The public listing for a PLANNER account. Mirrors the vendor listing shape so
 * both provider personas are searchable and bookable through the same paths.
 */
@Entity('planner_profiles')
export class PlannerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('uuid')
  ownerUserId: string;

  @Column()
  agencyName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Index()
  @Column({ nullable: true })
  city: string;

  @Column({ type: 'jsonb', default: [] })
  servesCities: string[];

  @Column({ type: 'jsonb', default: [] })
  packages: PlannerPackage[];

  @Column({ type: 'int', default: 0 })
  yearsExperience: number;

  // Contact and location details a couple needs to evaluate a planner, with
  // proper validation before the profile can be saved (EZ1-I69).
  @Column({ type: 'varchar', length: 120, nullable: true })
  contactPerson: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactPhone: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  contactEmail: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 6, nullable: true })
  pincode: string | null;

  /** Public social links, in order; the single columns mirror them (see Vendor). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  socialLinks: SocialLink[];

  @Column({ type: 'varchar', length: 200, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  instagramUrl: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  youtubeUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  portfolio: string[];

  // ------------------------------------------------------------ the showcase
  //
  // What a couple reads to choose a planner (planner-catalog.ts holds the keys).

  /** Services offered, as PLANNER_SERVICE_KEYS; a couple ticks these on a request. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  services: string[];

  /** Kinds of wedding, as PLANNER_SPECIALIZATION_KEYS: traditional, destination. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  specializations: string[];

  /** An uploaded film, or a YouTube / Vimeo page. */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  introVideoUrl: string | null;

  @Column({ type: 'int', nullable: true })
  weddingsCompleted: number | null;

  @Column({ type: 'text', nullable: true })
  planningApproach: string | null;

  /** Weddings the planner ran, each with its events, photographs and films. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  weddings: PlannerWedding[];

  @Column({ type: 'float', default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', default: 0 })
  ratingCount: number;

  @Index()
  @Column({ default: false })
  isApproved: boolean;

  /**
   * The gateway's linked account for this planner, once payout onboarding is done.
   *
   * Null is a normal state, not a missing value: a provider can take bookings
   * and complete work before their KYC clears. What it changes is that money
   * released from escrow stays there with a reason attached, rather than being
   * pushed at an account that does not exist.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  payoutAccountId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
