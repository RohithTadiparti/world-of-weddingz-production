import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PayoutOwnerType = 'vendor' | 'planner';

/**
 * Where a submitted bank account stands.
 *
 * `pending_verification` is the honest state after a provider submits: the
 * details were checked for shape and the IFSC resolved to a real branch, but
 * no gateway linked account exists for them yet, so no money can go there.
 * `linked` means a gateway account id has since been attached for them.
 */
export enum PayoutBankStatus {
  PENDING_VERIFICATION = 'pending_verification',
  LINKED = 'linked',
}

/**
 * The bank account a provider asked to be paid into.
 *
 * Its own table rather than columns on the listing, because listings are
 * returned whole by several routes, some of them public, and a bank account
 * must not ride along with any of them by accident. One row per provider
 * listing: a vendor business or a planner profile.
 *
 * The account number is held only sealed (see field-cipher.ts) and is never
 * selected by default; every read shows the last four digits.
 */
@Entity('payout_bank_accounts')
@Index(['ownerType', 'ownerId'], { unique: true })
export class PayoutBankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  ownerType: PayoutOwnerType;

  /** The vendor id or planner profile id. */
  @Column('uuid')
  ownerId: string;

  @Column({ type: 'varchar', length: 120 })
  accountHolderName: string;

  @Column({ type: 'varchar', length: 120 })
  bankName: string;

  @Column({ type: 'varchar', length: 16 })
  accountType: string;

  /** AES-GCM sealed account number. Never selected unless asked for. */
  @Column({ type: 'text', select: false })
  accountNumberSealed: string;

  @Column({ type: 'varchar', length: 4 })
  accountLast4: string;

  @Column({ type: 'varchar', length: 11 })
  ifsc: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  branch: string;

  @Column({ type: 'varchar', length: 32, default: PayoutBankStatus.PENDING_VERIFICATION })
  status: PayoutBankStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
