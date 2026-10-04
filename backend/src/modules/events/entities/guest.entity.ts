import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RsvpStatus } from '../../../common/enums';

@Entity('guests')
export class Guest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string; // the host who owns this guest record

  @Column()
  name: string;

  /**
   * Email address, where there is one. Named `contact` since before there was
   * a phone column; kept so existing rows and the invitation mail path do not
   * have to move at the same time.
   */
  @Column({ nullable: true })
  contact: string;

  /**
   * Mobile number.
   *
   * Separate from `contact` because chasing an RSVP in India happens by phone,
   * and an organiser looking at "not responded" needs the number in front of
   * them rather than in another system.
   */
  @Index()
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  /**
   * How many people this invitation covers — the family, not the person.
   *
   * Nullable on purpose: an unanswered head count is not a head count of one,
   * and catering ordered from the difference is a real amount of money.
   */
  @Column({ type: 'int', nullable: true })
  partySize: number | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  relation: string | null;

  /** The host's own notes; never shown to the guest. */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /**
   * The guest's one invitation to the whole wedding — every event the host
   * has — answered once. Null status means not invited yet. Per-event invites
   * are kept in step so event-level counts agree.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  rsvpStatus: RsvpStatus | null;

  @Index('IDX_guests_rsvp_token_hash', { unique: true, where: '"rsvpTokenHash" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true, select: false })
  rsvpTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rsvpTokenExpiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  attendingCount: number | null;

  @Column({ type: 'text', nullable: true })
  declineReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
